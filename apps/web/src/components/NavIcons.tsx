import type { SVGProps } from 'react';

type TabId = 'list' | 'calendar' | 'review' | 'settings';

/**
 * 下部ナビ用のラインアイコン（24x24, stroke=currentColor）。
 * 見納め間近=砂時計 / カレンダー=カレンダー / マッチ確認=リンク / 設定=スライダー。
 */
export function TabIcon({ tab, ...props }: { tab: TabId } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...props}
    >
      {tab === 'list' && (
        <path d="M7 3h10M7 21h10M8 3v3.1c0 .8.4 1.5 1.1 2L12 10.3l2.9-2.2c.7-.5 1.1-1.2 1.1-2V3M8 21v-3.1c0-.8.4-1.5 1.1-2L12 13.7l2.9 2.2c.7.5 1.1 1.2 1.1 2V21" />
      )}
      {tab === 'calendar' && (
        <>
          <rect x="3.6" y="5" width="16.8" height="15.4" rx="2.4" />
          <path d="M3.6 9.5h16.8M8 3v4M16 3v4" />
        </>
      )}
      {tab === 'review' && (
        <path d="M9.6 14.4l4.8-4.8M10.9 7.1 12.4 5.6a3.4 3.4 0 0 1 4.8 4.8l-1.5 1.5M13.1 16.9l-1.5 1.5a3.4 3.4 0 0 1-4.8-4.8l1.5-1.5" />
      )}
      {tab === 'settings' && (
        <>
          <path d="M4 7h9M17 7h3M4 17h3M11 17h9" />
          <circle cx="15" cy="7" r="2.3" />
          <circle cx="9" cy="17" r="2.3" />
        </>
      )}
    </svg>
  );
}
