import { useState } from 'react';
import {
  issueAlexaLinkCode,
  issueLineLinkCode,
  unlinkAlexa,
  unlinkLine,
  updateSettings,
  type UserInfo,
} from '../api';
import { MYLIST_URLS } from '../lib/services';

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];
const LINE_BOT_BASIC_ID: string | undefined = (import.meta as any).env?.VITE_LINE_BOT_BASIC_ID;
const ALEXA_SKILL_NAME: string | undefined = (import.meta as any).env?.VITE_ALEXA_SKILL_NAME;

interface Props {
  user: UserInfo;
  onUpdate: (u: UserInfo) => void;
}

export function SettingsPanel({ user, onUpdate }: Props) {
  const [notifyEmail, setNotifyEmail] = useState(user.notifyEmail);
  const [digestWeekday, setDigestWeekday] = useState(user.digestWeekday);
  const [thresholdDays, setThresholdDays] = useState(user.thresholdDays);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
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
    <div className="settings">
      <section className="card">
        <h2 className="card-title">通知設定</h2>
        <p className="card-desc">
          毎週の指定曜日に、配信終了が近い作品をまとめて通知します。
        </p>

        <div className="form-row">
          <label htmlFor="notify-email">通知先メールアドレス</label>
          <input
            id="notify-email"
            type="email"
            value={notifyEmail}
            onChange={(e) => setNotifyEmail(e.target.value)}
            placeholder="you@example.com"
          />
        </div>

        <div className="form-row">
          <label htmlFor="weekday">送信曜日</label>
          <div className="weekday-picker">
            {WEEKDAYS.map((label, idx) => (
              <button
                type="button"
                key={idx}
                className={`weekday-btn${digestWeekday === idx ? ' active' : ''}`}
                onClick={() => setDigestWeekday(idx)}
                aria-pressed={digestWeekday === idx}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="form-row">
          <label htmlFor="threshold">通知対象 残り日数</label>
          <div className="threshold-input">
            <input
              id="threshold"
              type="number"
              min={1}
              max={365}
              value={thresholdDays}
              onChange={(e) => setThresholdDays(Number(e.target.value) || 0)}
            />
            <span className="muted">日以内</span>
          </div>
        </div>

        <div className="form-actions">
          <button className="btn-primary" onClick={save} disabled={!dirty || saving}>
            {saving ? '保存中…' : '保存'}
          </button>
          {message && (
            <span className={message.kind === 'ok' ? 'msg-ok' : 'msg-error'}>
              {message.text}
            </span>
          )}
        </div>
      </section>

      <section className="card">
        <h2 className="card-title">通知チャンネル</h2>
        <p className="card-desc">
          ダイジェスト送信時にどのチャンネルへ流すかを選びます。
          LINE / Alexa は連携が必要です。
        </p>

        <div className="channel-row">
          <div className="channel-info">
            <div className="channel-title">メール</div>
            <div className="channel-desc muted">宛先: {user.notifyEmail}</div>
          </div>
          <ChannelToggle
            checked={user.notifyEmailEnabled}
            onChange={(v) => void toggleChannel('notifyEmailEnabled', v)}
          />
        </div>

        <div className="channel-row">
          <div className="channel-info">
            <div className="channel-title">
              LINE
              {user.lineLinked ? (
                <span className="badge-linked">連携済み</span>
              ) : (
                <span className="badge-unlinked">未連携</span>
              )}
            </div>
            <div className="channel-desc muted">公式アカウントから通知を受け取ります</div>
          </div>
          <ChannelToggle
            checked={user.notifyLineEnabled}
            disabled={!user.lineLinked}
            onChange={(v) => void toggleChannel('notifyLineEnabled', v)}
          />
        </div>

        <div className="channel-row">
          <div className="channel-info">
            <div className="channel-title">
              Alexa
              {user.alexaLinked ? (
                <span className="badge-linked">連携済み</span>
              ) : (
                <span className="badge-unlinked">未連携</span>
              )}
            </div>
            <div className="channel-desc muted">Alexa デバイスの通知センターに届きます</div>
          </div>
          <ChannelToggle
            checked={user.notifyAlexaEnabled}
            disabled={!user.alexaLinked}
            onChange={(v) => void toggleChannel('notifyAlexaEnabled', v)}
          />
        </div>
      </section>

      <LineLinkSection user={user} onUpdate={onUpdate} />

      <AlexaLinkSection user={user} onUpdate={onUpdate} />

      <section className="card">
        <h2 className="card-title">マイリストを開く</h2>
        <p className="card-desc">
          Netflix / Prime の自分のマイリストページを直接開けます。編集後、
          拡張機能の「同期」を押すとこのアプリに反映されます。
        </p>
        <div className="mylist-bar" style={{ margin: 0, border: 'none', padding: 0, boxShadow: 'none' }}>
          <a
            className="mylist-link netflix"
            href={MYLIST_URLS.netflix}
            target="_blank"
            rel="noreferrer"
          >
            <span className="badge netflix">Netflix</span>
            <span>マイリストを開く</span>
            <span className="ext-arrow">↗</span>
          </a>
          <a
            className="mylist-link prime"
            href={MYLIST_URLS.prime}
            target="_blank"
            rel="noreferrer"
          >
            <span className="badge prime">Prime</span>
            <span>ウォッチリストを開く</span>
            <span className="ext-arrow">↗</span>
          </a>
        </div>
      </section>

      <section className="card">
        <h2 className="card-title">拡張機能の接続</h2>
        <p className="card-desc">
          Chrome 拡張機能のポップアップに、下の2つの値を貼り付けてください。
        </p>
        <div className="kv-row">
          <span className="kv-label">API URL</span>
          <code className="kv-value">{window.location.origin}</code>
          <button
            className="btn-ghost"
            onClick={() => copy('API URL', window.location.origin)}
          >
            コピー
          </button>
        </div>
        <div className="kv-row">
          <span className="kv-label">ペアリングトークン</span>
          <code className="kv-value">{user.extensionToken}</code>
          <button
            className="btn-ghost"
            onClick={() => copy('ペアリングトークン', user.extensionToken)}
          >
            コピー
          </button>
        </div>
        {copiedLabel && <p className="msg-ok">「{copiedLabel}」をコピーしました</p>}
      </section>
    </div>
  );
}

function ChannelToggle({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className={`channel-toggle${disabled ? ' disabled' : ''}`}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="channel-toggle-track" />
    </label>
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
    <section className="card">
      <h2 className="card-title">LINE 連携</h2>
      {user.lineLinked ? (
        <>
          <p className="card-desc">
            LINE と連携済みです。週次ダイジェストが LINE にも届きます。
          </p>
          <button className="btn-ghost" onClick={unlink} disabled={busy}>
            {busy ? '解除中…' : '連携を解除'}
          </button>
        </>
      ) : (
        <>
          <p className="card-desc">
            手順:
          </p>
          <ol className="step-list">
            <li>
              下のボタンで <strong>6 桁の連携コード</strong> を発行する（10 分有効）
            </li>
            <li>
              LINE で公式アカウント
              {LINE_BOT_BASIC_ID ? (
                <>
                  {' '}
                  <code>{LINE_BOT_BASIC_ID}</code>
                </>
              ) : (
                ' （ID は管理者にご確認ください）'
              )}
              を友だち追加する
            </li>
            <li>トークでそのコードを送信する</li>
            <li>「連携しました」と返ってきたら完了</li>
          </ol>
          {!code ? (
            <button className="btn-primary" onClick={issue} disabled={busy}>
              {busy ? '発行中…' : '連携コードを発行'}
            </button>
          ) : (
            <div className="link-code-box">
              <div className="link-code">{code}</div>
              <div className="link-code-hint muted">
                LINE のトークにこのコードを送ってください
                {expiresAt && (
                  <>（{new Date(expiresAt).toLocaleTimeString()} まで有効）</>
                )}
              </div>
              <button className="btn-ghost" onClick={issue} disabled={busy}>
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
    : '「アレクサ、Netflix デッドラインを開いて」';

  return (
    <section className="card">
      <h2 className="card-title">Alexa 連携</h2>
      {user.alexaLinked ? (
        <>
          <p className="card-desc">
            Alexa と連携済みです。Alexa デバイスの通知センターにダイジェストが届きます。
          </p>
          <button className="btn-ghost" onClick={unlink} disabled={busy}>
            {busy ? '解除中…' : '連携を解除'}
          </button>
        </>
      ) : (
        <>
          <p className="card-desc">手順:</p>
          <ol className="step-list">
            <li>下のボタンで <strong>6 桁の連携コード</strong> を発行する（10 分有効）</li>
            <li>Alexa デバイスに {skillPhrase} と話しかける</li>
            <li>スキルが「コードを言ってください」と応答するので、コードを発話</li>
            <li>「連携しました」と返ってきたら完了</li>
          </ol>
          {!code ? (
            <button className="btn-primary" onClick={issue} disabled={busy}>
              {busy ? '発行中…' : '連携コードを発行'}
            </button>
          ) : (
            <div className="link-code-box">
              <div className="link-code">{code}</div>
              <div className="link-code-hint muted">
                Alexa にこのコードを発話してください
                {expiresAt && (
                  <>（{new Date(expiresAt).toLocaleTimeString()} まで有効）</>
                )}
              </div>
              <button className="btn-ghost" onClick={issue} disabled={busy}>
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
