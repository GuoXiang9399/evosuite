const path = require('path')
const { chromium } = require(path.join('/root/.nvm/versions/node/v22.13.1/lib/node_modules/playwright'))
;(async () => {
  const b = await chromium.launch({ executablePath: '/usr/bin/chromium', args: ['--no-sandbox'] })
  const page = await b.newPage({ viewport: { width: 1280, height: 900 } })
  const errors = []
  page.on('pageerror', e => errors.push('pageerror: '+e.message))
  await page.goto('file://'+path.resolve('preview.html'), { waitUntil: 'networkidle' })
  await page.waitForTimeout(400)
  await page.evaluate(() => { const x=[...document.querySelectorAll('button')].find(b=>/⚙\s*Set/.test((b.textContent||'').trim())); x&&x.click() })
  await page.waitForTimeout(400)
  const order = await page.evaluate(() => {
    const m = document.querySelector('.engines-modal')
    if (!m) return null
    return [...m.children].map(c => ({ tag: c.tagName.toLowerCase(), cls: c.className, text: (c.textContent||'').trim().slice(0, 70) }))
  })
  console.log(JSON.stringify({ order, errors }, null, 2))
  await page.screenshot({ path: 'preview_set_title.png' })
  await b.close()
})()
