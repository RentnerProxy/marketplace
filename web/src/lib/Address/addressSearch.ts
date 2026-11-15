import type {
    AddressSuggestion,
    NominatimResult,
    PhotonFeature,
} from '@/lib/Address/Types/address.types.ts'
import {
    nominatimResultsSchema,
    photonResultSchema,
} from './addressSearch.validation.ts'

function mapNominatimSuggestion(result: NominatimResult): AddressSuggestion {
    const address = result.address ?? {}
    return {
        id: `nominatim-${result.place_id}`,
        label: result.display_name,
        street:
            address.road ??
            address.pedestrian ??
            address.footway ??
            address.cycleway ??
            address.path ??
            address.residential ??
            '',
        houseNumber: address.house_number ?? '',
        postalCode: address.postcode ?? '',
        city:
            address.city ??
            address.town ??
            address.village ??
            address.municipality ??
            address.county ??
            '',
    }
}

function mapPhotonSuggestion(
    feature: PhotonFeature,
    index: number,
): AddressSuggestion {
    const properties = feature.properties
    const street = properties.street ?? properties.name ?? ''
    const city =
        properties.city ??
        properties.town ??
        properties.village ??
        properties.district ??
        properties.county ??
        ''
    const labelParts = [
        [street, properties.housenumber].filter(Boolean).join(' '),
        [properties.postcode, city].filter(Boolean).join(' '),
        properties.state,
        properties.country,
    ].filter(Boolean)

    return {
        id: `photon-${properties.osm_id ?? index}`,
        label: labelParts.join(', '),
        street,
        houseNumber: properties.housenumber ?? '',
        postalCode: properties.postcode ?? '',
        city,
    }
}

function getSearchQueries(value: string) {
    const withoutHouseNumber = value
        .replace(/\s+/g, ' ')
        .replace(/\b\d+[a-z]?\b/gi, '')
        .replace(/\s+/g, ' ')
        .trim()

    return Array.from(new Set([value, withoutHouseNumber])).filter(
        (query) => query.length >= 3,
    )
}

function dedupeSuggestions(items: Array<AddressSuggestion>) {
    const seenSuggestions = new Set<string>()
    return items.filter((suggestion) => {
        const key = [
            suggestion.street,
            suggestion.houseNumber,
            suggestion.postalCode,
            suggestion.city,
            suggestion.label,
        ]
            .join('|')
            .toLowerCase()

        if (seenSuggestions.has(key)) return false
        seenSuggestions.add(key)
        return true
    })
}

async function searchPhoton(query: string, signal: AbortSignal) {
    const response = await fetch(
        `https://photon.komoot.io/api/?limit=5&lang=de&q=${encodeURIComponent(query)}`,
        { signal },
    )
    if (!response.ok) return []
    const result = photonResultSchema.safeParse(await response.json())
    return result.success
        ? (result.data.features ?? []).map(mapPhotonSuggestion)
        : []
}

async function searchNominatim(query: string, signal: AbortSignal) {
    const response = await fetch(
        `https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=5&countrycodes=de&q=${encodeURIComponent(query)}`,
        { signal },
    )
    if (!response.ok) return []
    const result = nominatimResultsSchema.safeParse(await response.json())
    return result.success ? result.data.map(mapNominatimSuggestion) : []
}

async function findPhotonSuggestions(
    searchQueries: ReadonlyArray<string>,
    signal: AbortSignal,
    index = 0,
): Promise<Array<AddressSuggestion>> {
    const searchQuery = searchQueries[index]

    if (searchQuery === undefined) {
        return []
    }

    const suggestions = await searchPhoton(searchQuery, signal)

    return suggestions.length > 0
        ? suggestions
        : findPhotonSuggestions(searchQueries, signal, index + 1)
}

export async function searchAddressSuggestions(
    query: string,
    signal: AbortSignal,
) {
    const searchQueries = getSearchQueries(query)
    const photonSuggestions = await findPhotonSuggestions(searchQueries, signal)

    if (photonSuggestions.length > 0) {
        return dedupeSuggestions(photonSuggestions)
    }

    const nominatimResults = await Promise.all(
        searchQueries.map((searchQuery) =>
            searchNominatim(searchQuery, signal),
        ),
    )
    return dedupeSuggestions(nominatimResults.flat())
}
