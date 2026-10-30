import { expect, test } from '@playwright/test'

// Feasibility probe only: Chrome keyboard selection. Does not verify the OS share sheet,
// touch pickers, iOS Safari, Android, or file rendering/print quality.
test('prebuilt files can be shared synchronously from a native select change', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'Chromium keyboard feasibility probe only')

  await page.setContent(`
    <label for="format">Формат</label>
    <select id="format" aria-label="Формат экспорта">
      <option value="pdf">PDF</option>
      <option value="png">PNG</option>
    </select>
    <output id="result"></output>
    <script>
      const picker = document.querySelector('#format');
      const result = document.querySelector('#result');
      const events = [];
      const files = {
        pdf: new File(['%PDF-1.4'], 'month.pdf', { type: 'application/pdf' }),
        png: new File(['PNG'], 'month.png', { type: 'image/png' }),
      };
      picker.selectedIndex = -1;
      Object.defineProperty(navigator, 'canShare', {
        configurable: true,
        value: ({ files }) => files.length === 1,
      });
      Object.defineProperty(navigator, 'share', {
        configurable: true,
        value: ({ files }) => {
          events.push({ kind: 'share', type: files[0].type, activated: navigator.userActivation.isActive });
          result.textContent = JSON.stringify(events);
          return Promise.resolve();
        },
      });
      picker.addEventListener('change', () => {
        const file = files[picker.value];
        events.push({ kind: 'change', value: picker.value, activated: navigator.userActivation.isActive });
        if (file && navigator.canShare({ files: [file] }) && navigator.userActivation.isActive) {
          void navigator.share({ files: [file] });
        }
        picker.selectedIndex = -1;
        result.textContent = JSON.stringify(events);
      });
    </script>
  `)

  const picker = page.getByRole('combobox', { name: 'Формат экспорта' })
  await expect(picker.locator('option')).toHaveCount(2)
  await picker.focus()
  for (let i = 0; i < 2; i += 1) {
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Enter')
  }

  await expect(page.locator('#result')).toHaveText(JSON.stringify([
    { kind: 'change', value: 'pdf', activated: true },
    { kind: 'share', type: 'application/pdf', activated: true },
    { kind: 'change', value: 'pdf', activated: true },
    { kind: 'share', type: 'application/pdf', activated: true },
  ]))
})
