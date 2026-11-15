export type AddressSearchValue = {
    street: string
    houseNumber: string
    postalCode: string
    city: string
}

type NominatimAddress = {
    road?: string
    pedestrian?: string
    footway?: string
    cycleway?: string
    path?: string
    residential?: string
    house_number?: string
    postcode?: string
    city?: string
    town?: string
    village?: string
    municipality?: string
    county?: string
}

export type NominatimResult = {
    place_id: number
    display_name: string
    address?: NominatimAddress
}

type PhotonProperties = {
    osm_id?: number
    name?: string
    street?: string
    housenumber?: string
    postcode?: string
    city?: string
    town?: string
    village?: string
    district?: string
    county?: string
    state?: string
    country?: string
}

export type PhotonFeature = {
    properties: PhotonProperties
}

export type PhotonResult = {
    features?: Array<PhotonFeature>
}

export type AddressSuggestion = AddressSearchValue & {
    id: string
    label: string
}
