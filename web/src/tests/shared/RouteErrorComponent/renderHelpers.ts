import { isValidElement } from 'react'
import type { ReactElement, ReactNode } from 'react'

type ElementProps = Record<string, unknown> & { children?: ReactNode }

export function elements(node: ReactNode): Array<ReactElement<ElementProps>> {
    if (Array.isArray(node)) return node.flatMap(elements)
    if (!isValidElement<ElementProps>(node)) return []
    return [node, ...elements(node.props.children)]
}

export function findElement(
    node: ReactNode,
    predicate: (element: ReactElement<ElementProps>) => boolean,
) {
    const element = elements(node).find(predicate)
    if (!element) throw new Error('Expected rendered control was missing')
    return element
}

export function invoke(
    element: ReactElement<ElementProps>,
    name: string,
    ...args: Array<unknown>
) {
    const callback = element.props[name]
    if (typeof callback !== 'function')
        throw new Error(`Missing callback ${name}`)
    return callback(...args)
}
