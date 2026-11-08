// Validate every actual Vercel deployment URL, not matching text elsewhere.
export function validateVercelButtons(contents, label, required = false) {
  const buttons = []
  for (const link of contents.match(/(?:https?:)?\/\/[^\s"'<>)]*/gi) ?? []) {
    let url
    try {
      url = new URL(link.replaceAll('&amp;', '&'), 'https://vercel.com')
    } catch {
      continue
    } // An invalid URL cannot be a usable deployment button.
    const host = url.hostname.replace(/\.$/, '')
    if (
      ['vercel.com', 'www.vercel.com'].includes(host) &&
      /^\/new(?:\/|$)/.test(url.pathname)
    )
      buttons.push(url)
  }
  if (required && !buttons.length)
    throw new Error(`${label} must contain a deployment button`)
  for (const url of buttons) {
    const parameters = url.searchParams.getAll('env')
    const names = parameters.length === 1 ? parameters[0].split(',') : []
    if (!['JWT_SECRET', 'NWC_VAULT_SECRET'].every(name => names.includes(name)))
      throw new Error(
        `${label} must request both runtime secrets in every deployment button`
      )
  }
}
