import { useState } from 'react';
import { updateSettings, type UserInfo } from '../api';

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

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

  return (
    <div className="settings">
      <section className="card">
        <h2 className="card-title">通知設定</h2>
        <p className="card-desc">
          毎週の指定曜日に、配信終了が近い作品をまとめてメールで受け取れます。
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
