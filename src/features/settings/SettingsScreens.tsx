import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { automaticPreferences, manualCalculation, type SourcePreferences } from '../../domain/sourcePreferences'
import { effectiveCalculationSettings } from '../../domain/calculationSettings'
import type { CalculationSelection } from '../../domain/calculationSettings'
import type { ResolvedPrayerSource } from '../../domain/prayerSource'
import { CALCULATION_PROFILES, type CalculationProfileCapability, type CalculationProfileId, type HighLatitudeMethod } from '../../domain/prayerCalculation'
import { calculationCapabilityMessage, HIGH_LATITUDE_KEYS, PROFILE_LABEL_KEYS } from '../../ui/calculationLabels'
import { BackButton, Screen } from '../../ui/Screen'
import { ActionRow, ActionButton, ScreenFooter } from '../../ui/controls'
import { MarkdownArticle } from '../../ui/MarkdownArticle'
import { getInformationContent } from '../../content/contentRegistry'
import type { AppScreen } from '../../ui/useAppNavigation'
import type { ThemeFamily } from '../../domain/theme'
import { useLocalization } from '../../localization'
import type { createTranslator } from '../../localization/messages'
import { getAnalyticsPreferenceSnapshot, isCloudflareAnalyticsAvailableHere, saveAnalyticsPreference, subscribeToAnalyticsPreference } from '../../platform/analytics'

interface SettingsScreensProps {
  screen: AppScreen
  preferences: SourcePreferences
  sourceLabel: string
  effectiveSource?: ResolvedPrayerSource | null
  initialManualCalculation?: CalculationSelection | undefined
  themeFamily: ThemeFamily
  onThemeFamilyChange: (family: ThemeFamily) => void
  fastingModeEnabled?: boolean
  onFastingModeChange?: (enabled: boolean) => void
  onChange: (preferences: SourcePreferences) => void
  onOpen: (screen: AppScreen) => void
  onBack: () => void
  getCapability: (profile: CalculationProfileId) => CalculationProfileCapability
  onReset: () => Promise<boolean>
  notice?: ReactNode
  version?: string | undefined
}

export function SettingsScreens({ screen, preferences, sourceLabel, effectiveSource, initialManualCalculation, themeFamily, onThemeFamilyChange,
  fastingModeEnabled = false, onFastingModeChange = () => {}, onChange, onOpen, onBack, getCapability, onReset, notice, version }: SettingsScreensProps) {
  const { locale, t } = useLocalization()
  const analyticsPreference = useSyncExternalStore(subscribeToAnalyticsPreference, getAnalyticsPreferenceSnapshot, getAnalyticsPreferenceSnapshot)
  const storedManualSource = preferences.mode === 'manual' ? preferences.source : preferences.manualSourceDraft
  const manualSource = storedManualSource
  const calculation = preferences.mode === 'manual' ? preferences.source.calculation
    : preferences.calculationDraft ?? { profile: 'muslimWorldLeague', overrides: {} }
  const parameters = effectiveCalculationSettings(calculation)
  const mode = preferences.mode === 'automatic' ? 'automatic' : 'calculated'
  const profileSelectionRequired = screen === 'profiles' && preferences.mode === 'automatic' && !preferences.calculationDraft && !manualSource
  const restoreManual = (): SourcePreferences => manualSource?.kind === 'calculated'
    ? manualCalculation(manualSource.calculation) : manualCalculation(calculation)
  const profileLabel = t(PROFILE_LABEL_KEYS[calculation.profile])
  const legacy = calculation.overrides.fajrAngle !== undefined || calculation.overrides.isha !== undefined || Object.keys(calculation.overrides.adjustments ?? {}).length > 0
  const privacyContent = getInformationContent('privacy', locale)
  const aboutContent = getInformationContent('about', locale, version)
  const top = <BackButton onClick={onBack} />
  const row = (id: string, title: string, target: AppScreen, value?: string) => <ActionRow id={id} title={title} value={value} aria-label={value ? `${title} ${value}` : title} onClick={() => onOpen(target)} />
  if (screen === 'settings') return <Screen label={t('settings')} top={top} contentClassName="settings-menu" bottom={<ScreenFooter align="end"><ActionButton variant="auxiliary" id="settings-share" onClick={() => onOpen('share')}>{t('share')}</ActionButton></ScreenFooter>}>
    <div className="screen-stack">{row('settings-source', t('schedule'), 'source', sourceLabel)}
      <ActionRow id="settings-fasting-mode" className="fasting-mode-toggle" title={t('fastingMode')} role="switch"
        aria-checked={fastingModeEnabled} aria-label={t('fastingMode')} onClick={() => onFastingModeChange(!fastingModeEnabled)} />
      <label className="pill pill-row theme-field"><span>{t('theme')}</span><span className="note">{themeFamily === 'classic' ? t('classicTheme') : t('seasonalTheme')}</span>
        <select aria-label={t('theme')} value={themeFamily} onChange={event => onThemeFamilyChange(event.target.value as ThemeFamily)}>
          <option value="classic">{t('classicTheme')}</option><option value="seasonal">{t('seasonalTheme')}</option>
        </select>
      </label>
      {row('settings-privacy', t('privacy'), 'privacy')}{row('settings-about', t('about'), 'about')}{notice}</div>
  </Screen>
  if (screen === 'source') return <Screen label={t('scheduleSettings')} top={top} bottom={<ScreenFooter align="end"><ActionButton variant="auxiliary" id="source-info" onClick={() => onOpen('source-info')}>{t('scheduleInfo')}</ActionButton></ScreenFooter>}>
    <p className="screen-heading">{t('schedule')}</p><h1 className="screen-title">{mode === 'automatic' ? t('automatic') : t('choiceManual')}</h1>
    <p className="note screen-space">{mode === 'automatic' ? t('automaticScheduleDescription') : t('calculatedScheduleDescription')}</p>
    <div className="screen-stack screen-space">
      {row('source-method', t('method'), 'source-choice', mode === 'automatic' ? t('autoShort') : t('manualShort'))}
      {mode === 'automatic' ? <p className="note" role="status">{t('effectiveSource')}: {describeEffectiveSource(effectiveSource, t)}</p> : null}
      {mode === 'calculated' ? <>{row('source-profile', t('profile'), 'profiles', profileLabel)}{row('source-parameters', t('parameters'), 'parameters')}</> : null}
      {notice}
    </div>
  </Screen>
  if (screen === 'source-choice') {
    const choices = [
      { id: 'automatic', label: t('choiceAutomatic'), value: automaticPreferences(calculation, manualSource) },
      { id: 'manual', label: t('choiceManual'), value: manualSource ? restoreManual()
        : preferences.calculationDraft ? manualCalculation(preferences.calculationDraft)
          : initialManualCalculation ? manualCalculation(initialManualCalculation) : null },
    ]
    return <Screen label={t('sourceChoice')} top={top}><h1 className="screen-heading">{t('chooseSchedule')}</h1><div className="screen-stack screen-space">
      {choices.map(choice => <ActionRow key={choice.id} title={choice.label} value={(choice.id === 'automatic') === (mode === 'automatic') ? t('selected') : undefined} aria-pressed={(choice.id === 'automatic') === (mode === 'automatic')} onClick={() => {
        if (choice.value) { onChange(choice.value); onBack() }
        else onOpen('profiles')
      }} />
      )}{notice}
    </div></Screen>
  }
  if (screen === 'profiles') return <Screen label={t('calculationProfile')} top={top}><h1 className="screen-heading">{t('calculationProfile')}</h1>
    {legacy ? <p className="note screen-space">{t('replaceLegacy')}</p> : null}
    <div className="screen-stack screen-space">{CALCULATION_PROFILES.map(profile => {
      const capability = getCapability(profile.id)
      const capabilityMessage = calculationCapabilityMessage(profile.id, capability, t)
      return <div key={profile.id}><ActionRow title={t(PROFILE_LABEL_KEYS[profile.id])} value={!profileSelectionRequired && calculation.profile === profile.id ? t('selected') : undefined} disabled={!capability.supported} aria-pressed={!profileSelectionRequired && calculation.profile === profile.id}
        onClick={() => { onChange(manualCalculation({ profile: profile.id, overrides: {} })); onBack() }} />
        {capabilityMessage ? <p className="note">{capabilityMessage}</p> : null}</div>
    })}{notice}</div>
  </Screen>
  if (screen === 'parameters') return <Screen label={t('calculationParameters')} top={top}>
    <div className="screen-stack">
      <label className="screen-field"><span>{t('asr')}</span><select aria-label={t('asr')} className="select-field" value={parameters.asrMethod} onChange={event => {
        const asrMethod = event.target.value
        if (asrMethod === 'hanafi' || asrMethod === 'standard') onChange(manualCalculation({ ...calculation, overrides: { ...calculation.overrides, asrMethod } }))
      }}><option value="hanafi">{t('hanafi')}</option><option value="standard">{t('otherMadhhabs')}</option></select></label>
      <label className="screen-field"><span>{t('highLatitude')}</span><select aria-label={t('highLatitude')} className="select-field" value={parameters.highLatitudeRule} onChange={event => {
        const highLatitudeRule = event.target.value as HighLatitudeMethod
        if (Object.hasOwn(HIGH_LATITUDE_KEYS, highLatitudeRule)) onChange(manualCalculation({ ...calculation, overrides: { ...calculation.overrides, highLatitudeRule } }))
      }}>{Object.entries(HIGH_LATITUDE_KEYS).map(([key, labelKey]) => <option key={key} value={key}>{t(labelKey)}</option>)}</select></label>
      {legacy ? <div className="screen-stack"><p className="note">{t('savedLegacyAdjustments')}</p><ActionButton onClick={() => {
        const { fajrAngle: _angle, isha: _isha, adjustments: _adjustments, ...overrides } = calculation.overrides
        onChange(manualCalculation({ ...calculation, overrides }))
      }}>{t('byProfile')}</ActionButton></div> : null}{notice}
    </div>
  </Screen>
  if (screen === 'privacy') return <Screen label={t('privacy')} top={top} bottom={<ScreenFooter><ActionButton variant="primary" id="reset-trigger" onClick={() => onOpen('reset')}>{t('deleteData')}</ActionButton></ScreenFooter>}>
    <div className="screen-stack">
      <MarkdownArticle content={privacyContent.status === 'resolved' ? privacyContent.content : ''} />
      {notice}
      {isCloudflareAnalyticsAvailableHere() ? <>
        <ActionRow className="fasting-mode-toggle" title={t('analyticsVisits')} role="switch" aria-label={t('analyticsVisits')} aria-checked={analyticsPreference.enabled}
          aria-describedby="analytics-visits-description" onClick={() => { saveAnalyticsPreference(!analyticsPreference.enabled) }} />
        <p id="analytics-visits-description" className="note">{t('analyticsVisitsDescription')}</p>
        {analyticsPreference.error ? <p className="note" role="alert">{t(analyticsPreference.error === 'read' ? 'analyticsPreferenceReadFailed' : analyticsPreference.enabled ? 'analyticsPreferenceFailed' : 'analyticsEnableFailed')}</p> : null}
      </> : <p className="note" role="status">{t('analyticsUnavailable')}</p>}
    </div>
  </Screen>
  if (screen === 'about') return <Screen label={t('about')} top={top}><MarkdownArticle content={aboutContent.status === 'resolved' ? aboutContent.content : ''} /></Screen>
  if (screen === 'reset') return <ResetScreen onBack={onBack} onReset={onReset} />
  return null
}

function describeEffectiveSource(source: ResolvedPrayerSource | null | undefined, t: ReturnType<typeof createTranslator>): string {
  if (!source) return t('sourceNotResolved')
  if (source.status === 'unsupported') return t('effectiveCalculationUnsupported', { profile: t(PROFILE_LABEL_KEYS[source.settings.profile]) })
  return t('effectiveCalculation', { profile: t(PROFILE_LABEL_KEYS[source.settings.profile]), asr: source.settings.asrMethod === 'hanafi' ? t('hanafi') : t('otherMadhhabs') })
}

function ResetScreen({ onBack, onReset }: { onBack: () => void; onReset: () => Promise<boolean> }) {
  const [status, setStatus] = useState<'idle' | 'busy' | 'failed'>('idle')
  const active = useRef(true)
  useEffect(() => { active.current = true; return () => { active.current = false } }, [])
  const reset = async () => {
    setStatus('busy')
    try { if (!await onReset() && active.current) setStatus('failed') }
    catch { if (active.current) setStatus('failed') }
  }
  const { t } = useLocalization()
  return <Screen label={t('deleteData')} top={<ActionButton data-screen-focus onClick={onBack} disabled={status === 'busy'}>{t('back')}</ActionButton>}
    bottom={<ScreenFooter><ActionButton variant="primary" onClick={() => void reset()} disabled={status === 'busy'}>{status === 'busy' ? t('deletingData') : status === 'failed' ? t('retry') : t('deleteData')}</ActionButton></ScreenFooter>}>
    <p className="screen-title">{t('deleteDataQuestion')}</p><p className="screen-copy screen-space">{t('deleteDataDescription')}</p><p className="note screen-space">{t('deleteDataNotice')}</p>
    {status === 'failed' ? <p className="note screen-space" role="alert">{t('deleteDataFailed')}</p> : null}
  </Screen>
}
