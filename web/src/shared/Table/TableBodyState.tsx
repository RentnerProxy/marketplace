import { mergeClassNames } from '@/lib/Table/tableFilters.ts'
import type { TableBodyStateProps } from '@/shared/Table/Types/table.types.ts'

export function TableBodyState({
    columnCount,
    state,
    className = 'px-5 py-16',
}: TableBodyStateProps) {
    return (
        <tr>
            <td colSpan={columnCount} className={className}>
                <div className="flex flex-col items-center justify-center text-center">
                    {state.icon && (
                        <div
                            className={mergeClassNames(
                                'mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-input-dark/50',
                                state.iconWrapperClassName,
                            )}
                        >
                            {state.icon}
                        </div>
                    )}

                    {state.title && (
                        <h3
                            className={mergeClassNames(
                                'mb-1 text-base font-semibold text-white',
                                state.titleClassName,
                            )}
                        >
                            {state.title}
                        </h3>
                    )}

                    {state.description && (
                        <p
                            className={mergeClassNames(
                                'max-w-sm text-sm text-secondary-text',
                                state.descriptionClassName,
                            )}
                        >
                            {state.description}
                        </p>
                    )}
                </div>
            </td>
        </tr>
    )
}
