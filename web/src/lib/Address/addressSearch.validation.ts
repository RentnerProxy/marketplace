import { z } from 'zod'
import type {
    NominatimResult,
    PhotonResult,
} from '@/lib/Address/Types/address.types.ts'

export const photonResultSchema: z.ZodType<PhotonResult> = z.object({
    features: z
        .array(
            z.object({
                properties: z.object({
                    osm_id: z.number().optional(),
                    name: z.string().optional(),
                    street: z.string().optional(),
                    housenumber: z.string().optional(),
                    postcode: z.string().optional(),
                    city: z.string().optional(),
                    town: z.string().optional(),
                    village: z.string().optional(),
                    district: z.string().optional(),
                    county: z.string().optional(),
                    state: z.string().optional(),
                    country: z.string().optional(),
                }),
            }),
        )
        .optional(),
})

export const nominatimResultsSchema: z.ZodType<Array<NominatimResult>> =
    z.array(
        z.object({
            place_id: z.number(),
            display_name: z.string(),
            address: z
                .object({
                    road: z.string().optional(),
                    pedestrian: z.string().optional(),
                    footway: z.string().optional(),
                    cycleway: z.string().optional(),
                    path: z.string().optional(),
                    residential: z.string().optional(),
                    house_number: z.string().optional(),
                    postcode: z.string().optional(),
                    city: z.string().optional(),
                    town: z.string().optional(),
                    village: z.string().optional(),
                    municipality: z.string().optional(),
                    county: z.string().optional(),
                })
                .optional(),
        }),
    )
