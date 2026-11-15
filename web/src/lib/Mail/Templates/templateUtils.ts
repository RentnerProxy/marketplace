import type {
    MailHtmlFragment,
    MailHtmlInterpolation,
} from '../Types/mail-template.types.ts'

// Nur hier erzeugte, unveränderliche Fragmente dürfen HTML ungeescaped einfügen.
const trustedMailHtmlFragments = new WeakSet<MailHtmlFragment>()

export function escapeMailHtml(value: string) {
    return value
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;')
}

function createMailHtmlFragment(html: string): MailHtmlFragment {
    const fragment = Object.freeze({ html })
    trustedMailHtmlFragments.add(fragment)
    return fragment
}

function renderMailHtmlInterpolation(value: MailHtmlInterpolation): string {
    if (typeof value === 'string' || typeof value === 'number') {
        return escapeMailHtml(String(value))
    }

    if (value && trustedMailHtmlFragments.has(value)) {
        return value.html
    }

    throw new TypeError('Untrusted mail HTML fragment.')
}

export function mailHtml(
    strings: TemplateStringsArray,
    ...values: MailHtmlInterpolation[]
): MailHtmlFragment {
    let html = strings[0] ?? ''

    for (const [index, value] of values.entries()) {
        html += renderMailHtmlInterpolation(value) + (strings[index + 1] ?? '')
    }

    return createMailHtmlFragment(html)
}

export function joinMailHtml(
    fragments: readonly MailHtmlFragment[],
): MailHtmlFragment {
    return createMailHtmlFragment(
        fragments.map(renderMailHtmlInterpolation).join(''),
    )
}
