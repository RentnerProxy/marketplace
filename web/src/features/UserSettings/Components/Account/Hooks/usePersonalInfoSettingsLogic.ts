import type { PersonalInfoSettingsLogicReturn } from '../Types/account-logic.types.ts'
import { AppError } from '@/lib/Errors/appError.ts'
import { toastAppError } from '@/shared/Errors/toastAppError.ts'
import { toast } from '@rentnerkev/toasts'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { updateCurrentUserPersonalInfoHandler } from '../../../middleware.ts'
import { updateAuthenticatedSessionUserCache } from '@/lib/UserSettings/sessionCache.ts'
import useTranslationStore from '@/language/useTranslationStore.ts'
import type { PersonalInfoSectionProps } from '../../../Types/user-settings-component-props.types.ts'

function haveSamePersonalInfo(
    first: PersonalInfoSectionProps,
    second: PersonalInfoSectionProps,
) {
    return (
        first.city === second.city &&
        first.firstName === second.firstName &&
        first.houseNumber === second.houseNumber &&
        first.lastName === second.lastName &&
        first.postalCode === second.postalCode &&
        first.street === second.street
    )
}

export default function usePersonalInfoSettingsLogic({
    city,
    firstName,
    houseNumber,
    lastName,
    postalCode,
    street,
}: PersonalInfoSectionProps): PersonalInfoSettingsLogicReturn {
    const { t } = useTranslationStore()
    const queryClient = useQueryClient()
    const personalInfo = {
        city,
        firstName,
        houseNumber,
        lastName,
        postalCode,
        street,
    }
    const [previousPersonalInfo, setPreviousPersonalInfo] =
        useState(personalInfo)
    const [firstNameValue, setFirstNameValue] = useState(firstName)
    const [lastNameValue, setLastNameValue] = useState(lastName)
    const [streetValue, setStreetValue] = useState(street)
    const [houseNumberValue, setHouseNumberValue] = useState(houseNumber)
    const [postalCodeValue, setPostalCodeValue] = useState(postalCode)
    const [cityValue, setCityValue] = useState(city)

    if (!haveSamePersonalInfo(personalInfo, previousPersonalInfo)) {
        setPreviousPersonalInfo(personalInfo)
        setFirstNameValue(firstName)
        setLastNameValue(lastName)
        setStreetValue(street)
        setHouseNumberValue(houseNumber)
        setPostalCodeValue(postalCode)
        setCityValue(city)
    }

    const savePersonalInfoMutation = useMutation({
        mutationFn: async function () {
            return await updateCurrentUserPersonalInfoHandler({
                data: {
                    firstName: firstNameValue,
                    lastName: lastNameValue,
                    street: streetValue,
                    houseNumber: houseNumberValue,
                    postalCode: postalCodeValue,
                    city: cityValue,
                },
            })
        },
        onSuccess: function (result) {
            if (!result.success) {
                toastAppError(new AppError(result.error))
                return
            }

            toast.success(t('toast.personalInfoSaved'), {
                title: t('userSettings.header.title'),
            })
            updateAuthenticatedSessionUserCache(
                queryClient,
                result.personalInfo,
            )
        },
        onError: function (error) {
            toastAppError(error)
        },
    })

    const handleFirstNameChange: (value: string) => void = setFirstNameValue

    const handleLastNameChange: (value: string) => void = setLastNameValue

    const handleStreetChange: (value: string) => void = setStreetValue

    const handleHouseNumberChange: (value: string) => void = setHouseNumberValue

    const handlePostalCodeChange: (value: string) => void = setPostalCodeValue

    const handleCityChange: (value: string) => void = setCityValue

    function handleSavePersonalInfo() {
        savePersonalInfoMutation.mutate()
    }

    return {
        state: {
            cityValue,
            firstNameValue,
            houseNumberValue,
            isSavingPersonalInfo: savePersonalInfoMutation.isPending,
            lastNameValue,
            postalCodeValue,
            streetValue,
        },
        handler: {
            handleCityChange,
            handleFirstNameChange,
            handleHouseNumberChange,
            handleLastNameChange,
            handlePostalCodeChange,
            handleSavePersonalInfo,
            handleStreetChange,
        },
    }
}
