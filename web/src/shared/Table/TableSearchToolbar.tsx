import { TextInput } from '@rentnerkev/inputs'
import { Search } from 'lucide-react'
import type { RowData } from '@tanstack/react-table'
import TableFilterToggleButton from './TableFilterToggleButton.tsx'
import type { TableSearchToolbarProps } from '@/shared/Table/Types/table.types.ts'

export default function TableSearchToolbar<TData extends RowData>({
    table,
    value,
    placeholder,
    showColumnFilters,
    onChange,
    onToggleFilters,
    maxLength,
}: TableSearchToolbarProps<TData>) {
    return (
        <div className="flex w-full items-center gap-2 lg:w-auto">
            <label className="relative min-w-0 flex-1 lg:w-80">
                <TextInput
                    value={value}
                    maxLength={maxLength}
                    onValueChange={onChange}
                    placeholder={placeholder}
                    icon={<Search className="h-5 w-5" />}
                    className="h-10 w-full rounded-md"
                />
            </label>
            <table.Subscribe
                source={table.atoms.columnFilters}
                selector={(columnFilters) => columnFilters.length > 0}
            >
                {(hasColumnFilters) => (
                    <TableFilterToggleButton
                        isActive={showColumnFilters || hasColumnFilters}
                        onClick={onToggleFilters}
                    />
                )}
            </table.Subscribe>
        </div>
    )
}
