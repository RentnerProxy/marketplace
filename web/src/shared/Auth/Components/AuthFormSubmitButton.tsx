import type { AuthFormSubmitButtonProps } from '../Types/auth-component-props.types.ts'

export default function AuthFormSubmitButton({
    isLoading,
    loadingLabel,
    label,
}: AuthFormSubmitButtonProps) {
    return (
        <button
            type="submit"
            disabled={isLoading}
            className="mt-6 flex w-full cursor-pointer justify-center rounded-md bg-primary px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-primary-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-60"
        >
            {isLoading ? loadingLabel : label}
        </button>
    )
}
