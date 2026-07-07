import { useState } from 'react';
import {
  issueAlexaLinkCode,
  issueLineLinkCode,
  unlinkAlexa,
  unlinkLine,
  updateSettings,
  type UserInfo,
} from '../api';
import { WEEKDAYS_JA } from '../lib/date';

const LINE_BOT_BASIC_ID: string | undefined = (import.meta as any).env
  ?.VITE_LINE_BOT_BASIC_ID;
const ALEXA_SKILL_NAME: string | undefined = (import.meta as any).env
  ?.VITE_ALEXA_SKILL_NAME;

interface Props {
  user: UserInfo;
  onUpdate: (u: UserInfo) => void;
}

export function SettingsPanel({ user, onUpdate }: Props) {
  const [notifyEmail, setNotifyEmail] = useState(user.notifyEmail);
  const [digestWeekday, setDigestWeekday] = useState(user.digestWeekday);
  const [thresholdDays, setThresholdDays] = useState(user.thresholdDays);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(
    null
  );
  const [copiedLabel, setCopiedLabel] = useState<string | null>(null);

  const dirty =
    notifyEmail !== user.notifyEmail ||
    digestWeekday !== user.digestWeekday ||
    thresholdDays !== user.thresholdDays;

  const copy = async (label: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedLabel(label);
      setTimeout(() => setCopiedLabel(null), 2000);
    } catch {
      window.prompt(`${label} をコピーしてください`, value);
    }
  };

  const save = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const updated = await updateSettings({ notifyEmail, digestWeekday, thresholdDays });
      onUpdate(updated);
      setMessage({ kind: 'ok', text: '設定を保存しました' });
    } catch (e) {
      setMessage({ kind: 'error', text: e instanceof Error ? e.message : String(e) });
    } finally {
      setSaving(false);
    }
  };

  const toggleChannel = async (
    field: 'notifyEmailEnabled' | 'notifyLineEnabled' | 'notifyAlexaEnabled',
    next: boolean
  ) => {
    try {
      const updated = await updateSettings({ [field]: next });
      onUpdate(updated);
    } catch (e) {
      setMessage({ kind: 'error', text: e instanceof Error ? e.message : String(e) });
    }
  };

  return (
    <>
      <h1 className="page-title" style={{ marginBottom: 28 }}>
        SETTINGS
      </h1>

      {/* WEEKLY DIGEST */}
      <section className="settings-card">
        <h2 className="card-h">WEEKLY DIGEST — 週次ダイジェスト</h2>
        <p className="card-p">
          毎週の指定曜日に、配信終了が近い作品をまとめて通知します。
        </p>
        <div className="digest-fields">
          <div className="field">
            <label className="field__label">送信曜日</label>
            <div className="weekday-seg">
              {WEEKDAYS_JA.map((label, idx) => (
                <button
                  key={idx}
                  type="button"
                  className={`weekday-btn${digestWeekday === idx ? ' is-active' : ''}`}
                  onClick={() => setDigestWeekday(idx)}
                  aria-pressed={digestWeekday === idx}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="field">
            <label className="field__label">通知対象 残り日数</label>
            <div className="threshold">
              <input
                type="number"
                min={1}
                max={365}
                value={thresholdDays}
                onChange={(e) => setThresholdDays(Number(e.target.value) || 0)}
              />
              <span>日以内</span>
            </div>
          </div>
          <div className="field">
            <label className="field__label">通知先メールアドレス</label>
            <input
              type="email"
              value={notifyEmail}
              onChange={(e) => setNotifyEmail(e.target.value)}
              placeholder="you@example.com"
            />
          </div>
        </div>
        <button
          className="btn-accent digest-save"
          onClick={save}
          disabled={!dirty || saving}
        >
          {saving ? '保存中…' : '保存'}
        </button>
        {message && (
          <span className={`settings-msg ${message.kind}`}>{message.text}</span>
        )}
      </section>

      {/* CHANNELS */}
      <section className="settings-card">
        <h2 className="card-h">CHANNELS — 通知チャンネル</h2>
        <p className="card-p" style={{ marginBottom: 8 }}>
          ダイジェストの送信先。LINE / Alexa は下の連携が必要です。
        </p>

        <div className="channel-row">
          <div className="channel-info">
            <div className="channel-name">メール</div>
            <div className="channel-desc">宛先: {user.notifyEmail}</div>
          </div>
          <Toggle
            on={user.notifyEmailEnabled}
            onToggle={() => void toggleChannel('notifyEmailEnabled', !user.notifyEmailEnabled)}
          />
        </div>

        <div className="channel-row">
          <div className="channel-info">
            <div className="channel-name">
              LINE
              {user.lineLinked ? (
                <span className="chip-linked">連携済み</span>
              ) : (
                <span className="chip-unlinked">未連携</span>
              )}
            </div>
            <div className="channel-desc">公式アカウントから通知を受け取ります</div>
          </div>
          <Toggle
            on={user.notifyLineEnabled}
            disabled={!user.lineLinked}
            onToggle={() => void toggleChannel('notifyLineEnabled', !user.notifyLineEnabled)}
          />
        </div>

        <div className="channel-row">
          <div className="channel-info">
            <div className="channel-name">
              Alexa
              {user.alexaLinked ? (
                <span className="chip-linked">連携済み</span>
              ) : (
                <span className="chip-unlinked">未連携</span>
              )}
            </div>
            <div className="channel-desc">Alexa デバイスの通知センターに届きます</div>
          </div>
          <Toggle
            on={user.notifyAlexaEnabled}
            disabled={!user.alexaLinked}
            onToggle={() => void toggleChannel('notifyAlexaEnabled', !user.notifyAlexaEnabled)}
          />
        </div>
      </section>

      {/* LINE / Alexa 連携 */}
      <div className="link-grid">
        <LineLinkSection user={user} onUpdate={onUpdate} />
        <AlexaLinkSection user={user} onUpdate={onUpdate} />
      </div>

      {/* EXTENSION */}
      <section className="settings-card">
        <h2 className="card-h">EXTENSION — 拡張機能の接続</h2>
        <p className="card-p" style={{ marginBottom: 16 }}>
          Chrome 拡張機能のポップアップに、下の2つの値を貼り付けてください。
        </p>
        <div className="ext-row">
          <span className="ext-label">API URL</span>
          <code className="ext-code">{window.location.origin}</code>
          <button
            className="btn-ghost ext-copy"
            onClick={() => copy('API URL', window.location.origin)}
          >
            コピー
          </button>
        </div>
        <div className="ext-row">
          <span className="ext-label">ペアリングトークン</span>
          <code className="ext-code">{user.extensionToken}</code>
          <button
            className="btn-ghost ext-copy"
            onClick={() => copy('ペアリングトークン', user.extensionToken)}
          >
            コピー
          </button>
        </div>
        {copiedLabel && (
          <p className="settings-msg ok" style={{ marginLeft: 0, marginTop: 10 }}>
            「{copiedLabel}」をコピーしました
          </p>
        )}
      </section>
    </>
  );
}

function Toggle({
  on,
  disabled,
  onToggle,
}: {
  on: boolean;
  disabled?: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      className={`toggle${on ? ' is-on' : ''}${disabled ? ' is-disabled' : ''}`}
      onClick={() => !disabled && onToggle()}
      disabled={disabled}
      aria-pressed={on}
    >
      <span className="toggle__knob" />
    </button>
  );
}

function LineLinkSection({ user, onUpdate }: Props) {
  const [code, setCode] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const issue = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await issueLineLinkCode();
      setCode(r.code);
      setExpiresAt(r.expiresAt);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const unlink = async () => {
    if (!confirm('LINE 連携を解除しますか？（通知が届かなくなります）')) return;
    setBusy(true);
    setError(null);
    try {
      await unlinkLine();
      onUpdate({ ...user, lineLinked: false, notifyLineEnabled: false });
      setCode(null);
      setExpiresAt(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="settings-card" style={{ marginBottom: 0 }}>
      <div className="link-head">
        <h2 className="card-h">LINE 連携</h2>
        {user.lineLinked && <span className="chip-linked">連携済み</span>}
      </div>
      {user.lineLinked ? (
        <>
          <p className="linked-desc">
            LINE と連携済みです。週次ダイジェストが LINE にも届きます。
          </p>
          <button className="btn-ghost unlink-btn" onClick={unlink} disabled={busy}>
            {busy ? '解除中…' : '連携を解除'}
          </button>
        </>
      ) : (
        <>
          <ol className="step-ol">
            <li>
              下のボタンで <strong>6桁の連携コード</strong> を発行（10分有効）
            </li>
            <li>
              公式アカウント
              {LINE_BOT_BASIC_ID ? (
                <>
                  {' '}
                  <code>{LINE_BOT_BASIC_ID}</code>
                </>
              ) : null}
              を友だち追加
            </li>
            <li>トークでコードを送信 →「連携しました」で完了</li>
          </ol>
          {!code ? (
            <button className="btn-cream issue-btn" onClick={issue} disabled={busy}>
              {busy ? '発行中…' : '連携コードを発行'}
            </button>
          ) : (
            <div className="code-box">
              <div className="code">{code}</div>
              <div className="code-hint">
                LINE のトークにこのコードを送ってください
                {expiresAt && <>（{new Date(expiresAt).toLocaleTimeString()} まで有効）</>}
              </div>
              <button className="btn-ghost reissue-btn" onClick={issue} disabled={busy}>
                再発行
              </button>
            </div>
          )}
          {error && <p className="msg-error">{error}</p>}
        </>
      )}
    </section>
  );
}

function AlexaLinkSection({ user, onUpdate }: Props) {
  const [code, setCode] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const issue = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await issueAlexaLinkCode();
      setCode(r.code);
      setExpiresAt(r.expiresAt);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const unlink = async () => {
    if (!confirm('Alexa 連携を解除しますか？')) return;
    setBusy(true);
    setError(null);
    try {
      await unlinkAlexa();
      onUpdate({ ...user, alexaLinked: false, notifyAlexaEnabled: false });
      setCode(null);
      setExpiresAt(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const skillPhrase = ALEXA_SKILL_NAME
    ? `「アレクサ、${ALEXA_SKILL_NAME}を開いて」`
    : '「アレクサ、ミオサメを開いて」';

  return (
    <section className="settings-card" style={{ marginBottom: 0 }}>
      <div className="link-head">
        <h2 className="card-h">ALEXA 連携</h2>
        {user.alexaLinked && <span className="chip-linked">連携済み</span>}
      </div>
      {user.alexaLinked ? (
        <>
          <p className="linked-desc">
            Alexa デバイスと連携済みです。ダイジェストは通知センターに届きます。
          </p>
          <button className="btn-ghost unlink-btn" onClick={unlink} disabled={busy}>
            {busy ? '解除中…' : '連携を解除'}
          </button>
        </>
      ) : (
        <>
          <ol className="step-ol">
            <li>
              下のボタンで <strong>6桁の連携コード</strong> を発行（10分有効）
            </li>
            <li>{skillPhrase} と話しかける</li>
            <li>スキルにコードを発話 →「連携しました」で完了</li>
          </ol>
          {!code ? (
            <button className="btn-cream issue-btn" onClick={issue} disabled={busy}>
              {busy ? '発行中…' : '連携コードを発行'}
            </button>
          ) : (
            <div className="code-box">
              <div className="code">{code}</div>
              <div className="code-hint">
                Alexa にこのコードを発話してください
                {expiresAt && <>（{new Date(expiresAt).toLocaleTimeString()} まで有効）</>}
              </div>
              <button className="btn-ghost reissue-btn" onClick={issue} disabled={busy}>
                再発行
              </button>
            </div>
          )}
          {error && <p className="msg-error">{error}</p>}
        </>
      )}
    </section>
  );
}
