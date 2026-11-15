import type {
    LegalContent,
    LegalPageKind,
} from './Types/legal-content.types.ts'

export const legalOperator = {
    name: 'Kevin Sträßler',
    address: 'Nibelungenstraße 2, 63868 Großwallstadt',
    email: 'kevin@straessler-privat.de',
} as const

export const legalContent = {
    de: {
        imprint: {
            title: 'Impressum',
            eyebrow: 'Rechtliche Angaben',
            intro: 'Angaben zum Betreiber dieser Website und zum Projekt RentnerProxy Marketplace.',
            updatedLabel: 'Stand',
            updated: '15.11.2026',
            contactLabel: 'Kontakt per E-Mail',
            siblingLabel: 'Zum Datenschutz',
            sections: [
                {
                    title: 'Verantwortlicher Anbieter',
                    body: [
                        'Verantwortlich für den Inhalt dieser Website ist:',
                        legalOperator.name,
                        legalOperator.address,
                        `E-Mail: ${legalOperator.email}`,
                    ],
                },
                {
                    title: 'Projekt',
                    body: [
                        'Diese Website informiert über das öffentlich verfügbare Open-Source-Projekt RentnerProxy und den zugehörigen Marketplace für Apps und Erweiterungen. Das Projekt wird privat betrieben; ein Handelsregistereintrag oder eine Umsatzsteuer-Identifikationsnummer wird daher nicht angegeben.',
                        'Die öffentliche Registrierung ist derzeit eine deaktivierte Vorschau. Über diese Vorschau werden keine Konten angelegt und keine Zahlungen abgewickelt.',
                    ],
                },
                {
                    title: 'Verantwortung für Inhalte',
                    body: [
                        'Für journalistisch-redaktionelle Inhalte ist die verantwortliche Person nach § 18 Abs. 2 MStV dieselbe wie oben genannt.',
                    ],
                },
                {
                    title: 'Verbraucherstreitbeilegung',
                    body: [
                        'Ich bin nicht bereit und nicht verpflichtet, an Streitbeilegungsverfahren vor einer Verbraucherschlichtungsstelle teilzunehmen.',
                    ],
                },
            ],
        },
        privacy: {
            title: 'Datenschutz',
            eyebrow: 'Deine Daten',
            intro: 'Welche Daten beim Besuch und bei der Nutzung des RentnerProxy Marketplace verarbeitet werden und warum.',
            updatedLabel: 'Stand',
            updated: '15.11.2026',
            contactLabel: 'Datenschutzanfrage per E-Mail',
            siblingLabel: 'Zum Impressum',
            sections: [
                {
                    title: 'Verantwortlicher',
                    body: [
                        'Verantwortlich für die Verarbeitung personenbezogener Daten ist:',
                        legalOperator.name,
                        legalOperator.address,
                        `E-Mail: ${legalOperator.email}`,
                    ],
                },
                {
                    title: 'Hosting und Serverprotokolle',
                    body: [
                        'Die Website wird auf einem privaten Server des Betreibers in Deutschland bereitgestellt. Bei Aufrufen können technisch notwendige Verbindungsdaten wie IP-Adresse, Zeitpunkt, angeforderte URL und Statuscode verarbeitet werden. Die Anwendung verarbeitet außerdem Betriebs-, Fehler- und sicherheitsbezogene Auditdaten, um die Website stabil bereitzustellen und Missbrauch zu erkennen.',
                        'Rechtsgrundlage ist Art. 6 Abs. 1 lit. f DSGVO. Das berechtigte Interesse liegt in der sicheren, stabilen und missbrauchsarmen Bereitstellung der Website. Zugriff haben der Betreiber und administrierte Systemkonten.',
                        'Die technische Laufzeitprotokollansicht der Anwendung ist auf bis zu 300 Einträge pro Dienst und eine Stunde begrenzt. Das ist keine allgemeine Löschfrist für Auditdaten, Datenbanksicherungen oder Server- und Proxyprotokolle. Deren Aufbewahrung richtet sich nach der jeweiligen Betriebs- und Sicherungskonfiguration; eine feste Zeitspanne wird hier nicht zugesichert.',
                    ],
                },
                {
                    title: 'Konten und Anmeldung',
                    body: [
                        'Für bestehende Konten werden insbesondere Benutzername, E-Mail-Adresse, Berechtigungen und die für Anmeldung und Kontosicherheit erforderlichen Daten verarbeitet. Dazu gehören Passwort-Hashes, Sitzungsdaten und gegebenenfalls eingerichtete Passkeys, Zwei-Faktor-Authentifizierung, vertrauenswürdige Geräte und vom Nutzer ergänzte Profildaten. Sicherheitsrelevante Kontoaktionen werden protokolliert. Bei angeforderten Konto- oder Sicherheitsmails werden Empfängeradresse und die erforderlichen Nachrichteninhalte an den eingerichteten Maildienst übermittelt.',
                        'Die Verarbeitung dient dem Betrieb und Schutz der Konten und der Anwendung auf Grundlage von Art. 6 Abs. 1 lit. f DSGVO. Die öffentliche Registrierungsseite ist derzeit eine deaktivierte Vorschau und erfasst keine Anmeldedaten. Zahlungsdaten werden über diese Vorschau nicht verarbeitet.',
                    ],
                },
                {
                    title: 'Cookies und Browser-Speicher',
                    body: [
                        'Für die Anmeldung verwendet die Anwendung das technisch notwendige Cookie session_id. Sitzungen haben eine maximale Dauer von acht Stunden und laufen nach 15 Minuten Inaktivität ab. Wenn ein Gerät ausdrücklich als vertrauenswürdig bestätigt wird, kann trusted_device_token für bis zu 30 Tage gesetzt werden. Für die sichere Wiederaufnahme einer Anmeldung kann login_recovery für bis zu fünf Minuten verwendet werden.',
                        'Die ausgewählte Sprache wird unter app-language im lokalen Browser-Speicher gespeichert. Technische Rücksprung- und Wiederherstellungsinformationen können im sitzungsbezogenen Browser-Speicher abgelegt werden. Diese Informationen dienen der Bedienung und sicheren Navigation; sie sind keine Werbeprofile. Die Speicherung dient der Bereitstellung der jeweiligen Funktion (§ 25 Abs. 2 Nr. 2 TDDDG); die damit verbundene personenbezogene Verarbeitung erfolgt auf Grundlage von Art. 6 Abs. 1 lit. f DSGVO.',
                    ],
                },
                {
                    title: 'Analyse und externe Links',
                    body: [
                        'Nach aktuellem Quellcode werden keine Analyse- oder Werbedienste eingebunden. Externe Seiten wie GitHub oder die Projektwebsite werden erst beim Anklicken eines Links geöffnet; ab diesem Zeitpunkt gelten die Datenschutzinformationen des jeweiligen Anbieters.',
                    ],
                },
                {
                    title: 'Deine Rechte',
                    body: [
                        `Betroffene Personen haben nach Maßgabe der DSGVO insbesondere Rechte auf Auskunft, Berichtigung, Löschung, Einschränkung der Verarbeitung, Datenübertragbarkeit und Widerspruch. Außerdem besteht ein Beschwerderecht bei einer zuständigen Datenschutzaufsichtsbehörde. Für Anfragen genügt eine E-Mail an ${legalOperator.email}.`,
                    ],
                },
            ],
        },
    },
    en: {
        imprint: {
            title: 'Legal notice',
            eyebrow: 'Legal details',
            intro: 'Provider information for this website and the RentnerProxy Marketplace project.',
            updatedLabel: 'Updated',
            updated: '15 November 2026',
            contactLabel: 'Contact by email',
            siblingLabel: 'Privacy notice',
            sections: [
                {
                    title: 'Provider',
                    body: [
                        'The provider responsible for this website is:',
                        legalOperator.name,
                        legalOperator.address,
                        `Email: ${legalOperator.email}`,
                    ],
                },
                {
                    title: 'Project',
                    body: [
                        'This website presents the publicly available open-source RentnerProxy project and its marketplace for apps and extensions. The project is operated privately; no commercial register entry or VAT identification number is listed.',
                        'Public registration is currently a disabled preview. This preview does not create accounts or process payments.',
                    ],
                },
                {
                    title: 'Content responsibility',
                    body: [
                        'For journalistic and editorial content, the person responsible under section 18(2) MStV is the provider named above.',
                    ],
                },
                {
                    title: 'Consumer dispute resolution',
                    body: [
                        'I am neither willing nor obliged to participate in dispute resolution proceedings before a consumer arbitration board.',
                    ],
                },
            ],
        },
        privacy: {
            title: 'Privacy',
            eyebrow: 'Your data',
            intro: 'What data the RentnerProxy Marketplace processes when you visit or use it and why.',
            updatedLabel: 'Updated',
            updated: '15 November 2026',
            contactLabel: 'Privacy enquiry by email',
            siblingLabel: 'Legal notice',
            sections: [
                {
                    title: 'Controller',
                    body: [
                        'The controller responsible for processing personal data is:',
                        legalOperator.name,
                        legalOperator.address,
                        `Email: ${legalOperator.email}`,
                    ],
                },
                {
                    title: 'Hosting and server logs',
                    body: [
                        'The website is hosted on the operator’s private server in Germany. Requests may involve technically necessary connection data such as IP address, timestamp, requested URL and status code. The application also processes operational, error and security audit data to provide reliable service and detect misuse.',
                        'The legal basis is Article 6(1)(f) GDPR. The legitimate interest is providing the website securely, reliably and with protection against misuse. Access is limited to the operator and administered system accounts.',
                        'The application’s technical runtime log view is limited to up to 300 entries per service and one hour. This is not a general deletion deadline for audit data, database backups or server and proxy logs. Their retention depends on the applicable operational and backup configuration; no fixed period is promised here.',
                    ],
                },
                {
                    title: 'Accounts and sign-in',
                    body: [
                        'Existing accounts involve processing usernames, email addresses, permissions and data needed for sign-in and account security. This includes password hashes, session data and, where configured, passkeys, two-factor authentication, trusted devices and profile details supplied by the user. Security-related account actions are logged. Requested account or security emails involve sending the recipient address and necessary message content to the configured mail service.',
                        'This processing supports the operation and protection of accounts and the application under Article 6(1)(f) GDPR. The public registration page is currently a disabled preview and does not collect sign-up details. The preview does not process payment data.',
                    ],
                },
                {
                    title: 'Cookies and browser storage',
                    body: [
                        'Sign-in uses the technically necessary session_id cookie. Sessions last no longer than eight hours and expire after 15 minutes of inactivity. If a device is explicitly trusted, trusted_device_token may be set for up to 30 days. login_recovery may be used for up to five minutes to safely resume a sign-in.',
                        'The selected language is stored as app-language in local browser storage. Technical return-navigation and recovery information may be kept in session storage. These details support usability and safe navigation rather than advertising profiles. Storage provides the relevant functionality under section 25(2)(2) TDDDG; associated personal-data processing is based on Article 6(1)(f) GDPR.',
                    ],
                },
                {
                    title: 'Analytics and external links',
                    body: [
                        'The current source code does not include analytics or advertising services. External destinations such as GitHub or the project website open only after you select a link; their privacy notices apply from that point.',
                    ],
                },
                {
                    title: 'Your rights',
                    body: [
                        `Under the GDPR, data subjects may have rights to access, rectification, erasure, restriction, data portability and objection. You may also lodge a complaint with a competent data protection supervisory authority. Email ${legalOperator.email} for requests.`,
                    ],
                },
            ],
        },
    },
} satisfies Record<'de' | 'en', Record<LegalPageKind, LegalContent>>
