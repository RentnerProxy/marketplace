import { describe, expect, it, mock } from 'bun:test'
import { Home, Settings } from 'lucide-react'
import { renderToStaticMarkup } from 'react-dom/server'
import SegmentedTabs from '@/shared/SegmentedTabs.tsx'
import {
    elements,
    invoke,
} from '@/tests/shared/RouteErrorComponent/renderHelpers.ts'

describe('SegmentedTabs', () => {
    it('marks only the active tab as pressed and passes each selected key to its callback', () => {
        const onTabChange = mock()
        const tree = SegmentedTabs({
            activeTab: 'home',
            columns: 2,
            onTabChange,
            tabs: [
                { key: 'home', label: 'Home', icon: Home },
                { key: 'settings', label: 'Settings', icon: Settings },
            ],
        })
        const buttons = elements(tree).filter(
            (element) => element.type === 'button',
        )
        expect(buttons.map((button) => button.props['aria-pressed'])).toEqual([
            true,
            false,
        ])
        expect(renderToStaticMarkup(tree)).toContain('grid-cols-2')
        for (const button of buttons) invoke(button, 'onClick')
        expect(onTabChange).toHaveBeenNthCalledWith(1, 'home')
        expect(onTabChange).toHaveBeenNthCalledWith(2, 'settings')
    })
})
