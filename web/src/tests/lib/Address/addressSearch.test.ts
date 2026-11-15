import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test'
import {
    restoreTestGlobals,
    stubTestGlobal,
} from '@/tests/shared/bunTestStubs.ts'
import { searchAddressSuggestions } from '@/lib/Address/addressSearch.ts'

const fetchMock = vi.fn<typeof fetch>()

function jsonResponse(data: unknown, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { 'content-type': 'application/json' },
    })
}

describe('searchAddressSuggestions', function () {
    beforeEach(function () {
        fetchMock.mockReset()
        stubTestGlobal('fetch', fetchMock)
    })

    afterEach(function () {
        restoreTestGlobals()
    })

    it('probiert ohne Hausnummer weiter und normalisiert Photon-Treffer', async function () {
        fetchMock
            .mockResolvedValueOnce(jsonResponse({}, 503))
            .mockResolvedValueOnce(
                jsonResponse({
                    features: [
                        {
                            properties: {
                                osm_id: 42,
                                street: 'Hauptstraße',
                                housenumber: '12',
                                postcode: '10115',
                                city: 'Berlin',
                                state: 'Berlin',
                                country: 'Deutschland',
                            },
                        },
                        {
                            properties: {
                                osm_id: 42,
                                street: 'Hauptstraße',
                                housenumber: '12',
                                postcode: '10115',
                                city: 'Berlin',
                                state: 'Berlin',
                                country: 'Deutschland',
                            },
                        },
                        {
                            properties: {
                                name: 'Marktplatz',
                                town: 'Potsdam',
                            },
                        },
                        { properties: { name: 'Dorfweg', village: 'Dorf' } },
                        {
                            properties: {
                                street: 'Ring',
                                district: 'Mitte',
                            },
                        },
                        {
                            properties: {
                                street: 'Landweg',
                                county: 'Landkreis',
                            },
                        },
                        { properties: {} },
                    ],
                }),
            )

        const signal = new AbortController().signal
        const result = await searchAddressSuggestions(
            '  Hauptstraße   12  ',
            signal,
        )

        expect(fetchMock).toHaveBeenCalledTimes(2)
        expect(fetchMock.mock.calls[0]?.[0]).toContain(
            'q=%20%20Hauptstra%C3%9Fe%20%20%2012%20%20',
        )
        expect(fetchMock.mock.calls[1]?.[0]).toContain('q=Hauptstra%C3%9Fe')
        expect(fetchMock.mock.calls[1]?.[1]).toEqual({ signal })
        expect(result).toHaveLength(6)
        expect(result[0]).toEqual({
            id: 'photon-42',
            label: 'Hauptstraße 12, 10115 Berlin, Berlin, Deutschland',
            street: 'Hauptstraße',
            houseNumber: '12',
            postalCode: '10115',
            city: 'Berlin',
        })
        expect(result.map((suggestion) => suggestion.city)).toEqual([
            'Berlin',
            'Potsdam',
            'Dorf',
            'Mitte',
            'Landkreis',
            '',
        ])
        expect(result.at(-1)?.id).toBe('photon-6')
    })

    it('nutzt Nominatim als Fallback und entfernt identische Ergebnisse', async function () {
        fetchMock
            .mockResolvedValueOnce(jsonResponse({ features: [] }))
            .mockResolvedValueOnce(
                jsonResponse([
                    {
                        place_id: 1,
                        display_name: 'Hauptstraße 12, Berlin',
                        address: {
                            road: 'Hauptstraße',
                            house_number: '12',
                            postcode: '10115',
                            city: 'Berlin',
                        },
                    },
                    {
                        place_id: 2,
                        display_name: 'Hauptstraße 12, Berlin',
                        address: {
                            road: 'Hauptstraße',
                            house_number: '12',
                            postcode: '10115',
                            city: 'Berlin',
                        },
                    },
                    {
                        place_id: 3,
                        display_name: 'Fußweg',
                        address: { pedestrian: 'Promenade', town: 'Stadt' },
                    },
                    {
                        place_id: 4,
                        display_name: 'Pfad',
                        address: { footway: 'Fußpfad', village: 'Dorf' },
                    },
                    {
                        place_id: 5,
                        display_name: 'Radweg',
                        address: {
                            cycleway: 'Radweg',
                            municipality: 'Gemeinde',
                        },
                    },
                    {
                        place_id: 6,
                        display_name: 'Wanderweg',
                        address: { path: 'Wanderweg', county: 'Kreis' },
                    },
                    {
                        place_id: 7,
                        display_name: 'Wohnweg',
                        address: { residential: 'Wohnweg' },
                    },
                    { place_id: 8, display_name: 'Ohne Adresse' },
                ]),
            )

        const result = await searchAddressSuggestions(
            'Berlin',
            new AbortController().signal,
        )

        expect(fetchMock).toHaveBeenCalledTimes(2)
        expect(fetchMock.mock.calls[1]?.[0]).toContain('nominatim')
        expect(result).toHaveLength(7)
        expect(result.map((suggestion) => suggestion.street)).toEqual([
            'Hauptstraße',
            'Promenade',
            'Fußpfad',
            'Radweg',
            'Wanderweg',
            'Wohnweg',
            '',
        ])
    })

    it('liefert bei zu kurzer Suche oder nicht erreichbaren Providern leer zurück', async function () {
        await expect(
            searchAddressSuggestions('12', new AbortController().signal),
        ).resolves.toEqual([])
        expect(fetchMock).not.toHaveBeenCalled()

        fetchMock
            .mockResolvedValueOnce(jsonResponse({ features: [] }))
            .mockResolvedValueOnce(jsonResponse({}, 429))

        await expect(
            searchAddressSuggestions('abc', new AbortController().signal),
        ).resolves.toEqual([])
    })

    it('nutzt bei beschädigten Photon-Daten weiterhin den Fallback', async function () {
        fetchMock
            .mockResolvedValueOnce(
                jsonResponse({ features: [{ properties: { street: 42 } }] }),
            )
            .mockResolvedValueOnce(
                jsonResponse([{ place_id: 1, display_name: 'Berlin' }]),
            )
        await expect(
            searchAddressSuggestions('Berlin', new AbortController().signal),
        ).resolves.toMatchObject([{ id: 'nominatim-1', label: 'Berlin' }])
    })

    it.each(
        [
            null,
            {},
            [null],
            [{ place_id: 'invalid', display_name: 'Berlin' }],
        ].map((value) => ({ value })),
    )('verwirft beschädigte Nominatim-Daten: %j', async function ({ value }) {
        fetchMock
            .mockResolvedValueOnce(jsonResponse({ features: [] }))
            .mockResolvedValueOnce(jsonResponse(value))
        await expect(
            searchAddressSuggestions('Berlin', new AbortController().signal),
        ).resolves.toEqual([])
    })
})
