import type { ImageCropSelection } from '@/shared/Images/Types/image-crop-selection.types.ts'
import type {
    PersonalInfoSectionProps,
    ProfileImageSectionProps,
} from '../../../Types/user-settings-component-props.types.ts'

export type AccountSettingsLogicReturn = {
    state: PersonalInfoSectionProps & ProfileImageSectionProps
}

export type PersonalInfoSettingsLogicReturn = {
    state: {
        cityValue: string
        firstNameValue: string
        houseNumberValue: string
        isSavingPersonalInfo: boolean
        lastNameValue: string
        postalCodeValue: string
        streetValue: string
    }
    handler: {
        handleCityChange: (value: string) => void
        handleFirstNameChange: (value: string) => void
        handleHouseNumberChange: (value: string) => void
        handleLastNameChange: (value: string) => void
        handlePostalCodeChange: (value: string) => void
        handleSavePersonalInfo: () => void
        handleStreetChange: (value: string) => void
    }
}

export type ProfileImageSettingsLogicReturn = {
    state: Pick<ImageCropSelection['state'], 'crop' | 'imageSrc' | 'zoom'> & {
        copy: boolean
        isSavingProfileImage: boolean
    }
    handler: Pick<
        ImageCropSelection['handler'],
        'handleCropComplete' | 'handleSelectImage'
    > & {
        handleCopy: () => Promise<void>
        handleCropChange: (crop: ImageCropSelection['state']['crop']) => void
        handleZoomChange: (zoom: number) => void
        handleResetSelectedImage: () => void
        handleSaveProfileImage: () => void
    }
}
