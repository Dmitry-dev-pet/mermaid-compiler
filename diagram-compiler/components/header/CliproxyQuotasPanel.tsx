import React from 'react';
import type { CliproxyAuthFile } from '../../services/cliproxy/types';
import type { CliproxyQuotasState } from '../../services/cliproxy/quotas/types';
import { normalizeCliproxyProviderKey } from '../../utils/cliproxyAuthFileStatus';
import { remainingPercentFromUsedPercent } from '../../utils/percent';

type CliproxyQuotasPanelProps = {
  authFiles: CliproxyAuthFile[];
  quotas: CliproxyQuotasState;
  showAverage: boolean;
  onToggleMode: () => void;
  onRefresh: () => void;
  formatMonthDayTime: (date: Date) => string;
};

export const CliproxyQuotasPanel: React.FC<CliproxyQuotasPanelProps> = ({
  authFiles,
  quotas,
  showAverage,
  onToggleMode,
  onRefresh,
  formatMonthDayTime,
}) => {
  return (
    <div className="mt-1 flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2 text-slate-400">
        <button
          type="button"
          className="hover:underline"
          onClick={onToggleMode}
        >
          Mode:{' '}
          <span className={showAverage ? 'font-semibold text-blue-600 dark:text-blue-400' : ''}>
            Average
          </span>
          <span className="mx-1 text-slate-400">/</span>
          {!showAverage ? (
            <span className="font-semibold text-blue-600 dark:text-blue-400">All</span>
          ) : (
            <span className="text-slate-400">All</span>
          )}
        </button>
        <button type="button" className="hover:underline" onClick={onRefresh}>
          Refresh
        </button>
      </div>
      {quotas.status === 'loading' ? (
        <div className="text-slate-400">Loading quota...</div>
      ) : quotas.status === 'error' ? (
        <div className="text-amber-600 dark:text-amber-400">quota {quotas.error}</div>
      ) : null}

      <div className="flex flex-col gap-2">
        {(() => {
          const files = authFiles.filter((f) => normalizeCliproxyProviderKey(f.provider ?? null) === 'codex' && !f.runtimeOnly);
          if (files.length === 0) return (
            <div className="text-slate-400">Codex Quota: no auth files</div>
          );
          const fileLabel = (file: CliproxyAuthFile) => file.email ?? file.label ?? file.name ?? file.id;
          if (!showAverage) {
            const entries = files
              .map((file) => {
                const quota = quotas.codex?.[file.id];
                const planTypeRaw = typeof (quota?.planType ?? file.planType) === 'string'
                  ? (quota?.planType ?? file.planType).trim()
                  : '';
                const planType = planTypeRaw ? planTypeRaw.toLowerCase() : null;
                const windows = quota?.windows ?? [];
                const primary = windows.find((w) => w?.id === 'primary') ?? null;
                const weekly = windows.find((w) => w?.id === 'secondary') ?? null;
                const primaryPercent = primary ? remainingPercentFromUsedPercent(primary.usedPercent) : null;
                const weeklyPercent = weekly ? remainingPercentFromUsedPercent(weekly.usedPercent) : null;
                const primaryLabel = primary?.label ?? '5-hour limit';
                const weeklyLabel = weekly?.label ?? 'Weekly limit';
                return {
                  id: file.id,
                  label: fileLabel(file),
                  planType,
                  items: [
                    { id: 'primary', label: primaryLabel, percent: primaryPercent, resetLabel: primary?.resetLabel ?? '-' },
                    { id: 'secondary', label: weeklyLabel, percent: weeklyPercent, resetLabel: weekly?.resetLabel ?? '-' },
                  ],
                };
              })
              .sort((a, b) => a.label.localeCompare(b.label));
            return (
              <div className="flex flex-col gap-2">
                <div className="text-slate-500 dark:text-slate-400">Codex Quota</div>
                <div className="rounded border border-slate-200 dark:border-slate-700 p-2">
                  <div className="flex flex-col gap-2">
                    {entries.map((e) => (
                      <div key={e.id} className="flex flex-col gap-1 pb-2 border-b border-slate-200/60 dark:border-slate-700/60 last:border-b-0 last:pb-0">
                        <div className="flex items-center justify-between gap-2">
                          <div className="truncate">{e.label}</div>
                          {e.planType ? (
                            <div className="shrink-0 font-mono tabular-nums text-[10px] text-slate-400">{e.planType}</div>
                          ) : null}
                        </div>
                        <div className="flex flex-col gap-1">
                          {e.items.map((it) => {
                            const percent = typeof it.percent === 'number' ? Math.max(0, Math.min(100, it.percent)) : null;
                            const tone = percent === null
                              ? 'bg-slate-200 dark:bg-slate-700'
                              : percent >= 60
                                ? 'bg-emerald-500'
                                : percent >= 20
                                  ? 'bg-amber-500'
                                  : 'bg-rose-500';
                            return (
                              <div key={it.id} className="flex flex-col gap-0.5">
                                <div className="flex items-center justify-between gap-2">
                                  <span className="truncate">{it.label}</span>
                                  <span className="font-mono tabular-nums text-slate-400">{percent === null ? '-' : `${Math.round(percent)}%`} · {it.resetLabel}</span>
                                </div>
                                <div className="h-1.5 w-full rounded bg-slate-100 dark:bg-slate-800 overflow-hidden">
                                  <div
                                    className={`h-full ${tone}`}
                                    style={{ width: `${percent === null ? 0 : percent}%` }}
                                  />
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="mt-1 text-[10px] text-slate-400">{files.length} subscriptions</div>
                </div>
              </div>
            );
          }
          const aggByWindowId = new Map<string, {
            label: string;
            bestRemaining: number | null;
            bestResetLabel: string;
            sumRemaining: number;
            count: number;
          }>();
          files.forEach((file) => {
            const quota = quotas.codex?.[file.id];
            const windows = quota?.windows ?? [];
            const weeklyWindow = windows.find((w) => w?.id === 'secondary') ?? null;
            const weeklyRemainingPercent =
              remainingPercentFromUsedPercent(weeklyWindow?.usedPercent);
            const weeklyExhausted = weeklyRemainingPercent === 0;
            windows.forEach((w) => {
              if (!w?.id) return;
              if (w.id === 'primary' && weeklyExhausted) return;
              const remainingPercent = remainingPercentFromUsedPercent(w.usedPercent);
              const prev = aggByWindowId.get(w.id) ?? {
                label: w.label,
                bestRemaining: null,
                bestResetLabel: '-',
                sumRemaining: 0,
                count: 0,
              };
              if (remainingPercent !== null) {
                prev.sumRemaining += remainingPercent;
                prev.count += 1;
              }
              if (
                remainingPercent !== null
                && (prev.bestRemaining === null || remainingPercent > prev.bestRemaining)
              ) {
                prev.bestRemaining = remainingPercent;
                prev.bestResetLabel = w.resetLabel;
                prev.label = w.label;
              } else if (prev.bestResetLabel === '-' && w.resetLabel !== '-') {
                prev.bestResetLabel = w.resetLabel;
              }
              aggByWindowId.set(w.id, prev);
            });
          });

          const ordered = ['primary', 'secondary']
            .map((id) => {
              const agg = aggByWindowId.get(id);
              if (!agg) return null;
              const percent = showAverage ? (agg.count > 0 ? agg.sumRemaining : null) : agg.bestRemaining;
              const barPercent = showAverage ? (agg.count > 0 ? agg.sumRemaining / agg.count : null) : percent;
              return {
                id,
                label: agg.label,
                percent,
                barPercent,
                resetLabel: agg.bestResetLabel,
                count: agg.count,
              };
            })
            .filter(Boolean) as Array<{
              id: string;
              label: string;
              percent: number | null;
              barPercent: number | null;
              resetLabel: string;
              count: number;
            }>;

          const planCounts = files.reduce((acc, file) => {
            const quotaPlan = quotas.codex?.[file.id]?.planType;
            const planRaw = typeof (quotaPlan ?? file.planType) === 'string'
              ? (quotaPlan ?? file.planType).trim().toLowerCase()
              : '';
            if (!planRaw) return acc;
            acc[planRaw] = (acc[planRaw] ?? 0) + 1;
            return acc;
          }, {} as Record<string, number>);
          const planSummary = Object.entries(planCounts)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([plan, count]) => `${plan}×${count}`)
            .join(' · ');

          return (
            <div className="flex flex-col gap-2">
              <div className="text-slate-500 dark:text-slate-400">Codex Quota</div>
              <div className="rounded border border-slate-200 dark:border-slate-700 p-2">
                {ordered.length ? (
                  <div className="flex flex-col gap-1">
                    {ordered.map((w) => {
                      const bar = typeof w.barPercent === 'number' ? Math.max(0, Math.min(100, w.barPercent)) : null;
                      const tone = bar === null
                        ? 'bg-slate-200 dark:bg-slate-700'
                        : bar >= 60
                          ? 'bg-emerald-500'
                          : bar >= 20
                            ? 'bg-amber-500'
                            : 'bg-rose-500';
                      const label = w.percent === null
                        ? '-'
                        : showAverage
                          ? `${bar === null ? '-' : `${Math.round(bar)}%`}`
                          : `${Math.round(w.percent)}%`;
                      return (
                        <div key={w.id} className="flex flex-col gap-0.5" title={showAverage ? `${w.count} subscriptions` : undefined}>
                          <div className="flex items-center justify-between gap-2">
                            <span className="truncate">{w.label}</span>
                            <span className="font-mono tabular-nums text-slate-400">{label} · {w.resetLabel}</span>
                          </div>
                          <div className="h-1.5 w-full rounded bg-slate-100 dark:bg-slate-800 overflow-hidden">
                            <div
                              className={`h-full ${tone}`}
                              style={{ width: `${bar === null ? 0 : bar}%` }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="text-slate-400">No quota data</div>
                )}
                <div className="mt-1 text-[10px] text-slate-400">
                  {files.length} subscriptions{planSummary ? ` · ${planSummary}` : ''}
                </div>
              </div>
            </div>
          );
        })()}

        {(() => {
          const files = authFiles.filter((f) => normalizeCliproxyProviderKey(f.provider ?? null) === 'gemini-cli' && !f.runtimeOnly);
          if (files.length === 0) return (
            <div className="text-slate-400">Gemini CLI Quota: no auth files</div>
          );
          const fileLabel = (file: CliproxyAuthFile) => file.email ?? file.label ?? file.name ?? file.id;
          if (!showAverage) {
            const entries = files
              .map((file) => {
                const quota = quotas.geminiCli?.[file.id];
                const items = (quota?.items ?? []).slice().sort((a, b) => a.label.localeCompare(b.label));
                return {
                  id: file.id,
                  label: fileLabel(file),
                  items: items.map((it) => ({
                    id: it.id,
                    label: it.label,
                    percent: typeof it.remainingPercent === 'number' ? Math.max(0, Math.min(100, it.remainingPercent)) : null,
                    resetLabel: it.resetLabel ?? '-',
                  })),
                };
              })
              .sort((a, b) => a.label.localeCompare(b.label));
            return (
              <div className="flex flex-col gap-2">
                <div className="text-slate-500 dark:text-slate-400">Gemini CLI Quota</div>
                <div className="rounded border border-slate-200 dark:border-slate-700 p-2">
                  <div className="flex flex-col gap-2">
                    {entries.map((e) => (
                      <div key={e.id} className="flex flex-col gap-1 pb-2 border-b border-slate-200/60 dark:border-slate-700/60 last:border-b-0 last:pb-0">
                        <div className="truncate">{e.label}</div>
                        <div className="flex flex-col gap-1">
                          {e.items.map((it) => {
                            const percent = typeof it.percent === 'number' ? Math.max(0, Math.min(100, it.percent)) : null;
                            const tone = percent === null
                              ? 'bg-slate-200 dark:bg-slate-700'
                              : percent >= 60
                                ? 'bg-emerald-500'
                                : percent >= 20
                                  ? 'bg-amber-500'
                                  : 'bg-rose-500';
                            return (
                              <div key={it.id} className="flex flex-col gap-0.5">
                                <div className="flex items-center justify-between gap-2">
                                  <span className="truncate">{it.label}</span>
                                  <span className="font-mono tabular-nums text-slate-400">{percent === null ? '-' : `${Math.round(percent)}%`} · {it.resetLabel}</span>
                                </div>
                                <div className="h-1.5 w-full rounded bg-slate-100 dark:bg-slate-800 overflow-hidden">
                                  <div
                                    className={`h-full ${tone}`}
                                    style={{ width: `${percent === null ? 0 : percent}%` }}
                                  />
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="mt-1 text-[10px] text-slate-400">{files.length} subscriptions</div>
                </div>
              </div>
            );
          }
          const aggByItemId = new Map<string, {
            label: string;
            bestRemaining: number | null;
            bestResetLabel: string;
            sumRemaining: number;
            count: number;
          }>();
          files.forEach((file) => {
            const quota = quotas.geminiCli?.[file.id];
            const items = quota?.items ?? [];
            items.forEach((it) => {
              if (!it?.id) return;
              const percent = typeof it.remainingPercent === 'number' ? Math.max(0, Math.min(100, it.remainingPercent)) : null;
              const prev = aggByItemId.get(it.id) ?? {
                label: it.label,
                bestRemaining: null,
                bestResetLabel: '-',
                sumRemaining: 0,
                count: 0,
              };
              if (percent !== null) {
                prev.sumRemaining += percent;
                prev.count += 1;
              }
              if (
                percent !== null
                && (prev.bestRemaining === null || percent > prev.bestRemaining)
              ) {
                prev.bestRemaining = percent;
                prev.bestResetLabel = it.resetLabel;
                prev.label = it.label;
              } else if (prev.bestResetLabel === '-' && it.resetLabel !== '-') {
                prev.bestResetLabel = it.resetLabel;
              }
              aggByItemId.set(it.id, prev);
            });
          });
          const aggItems = Array.from(aggByItemId.entries())
            .map(([id, agg]) => {
              const percent = showAverage ? (agg.count > 0 ? agg.sumRemaining : null) : agg.bestRemaining;
              const barPercent = showAverage ? (agg.count > 0 ? agg.sumRemaining / agg.count : null) : percent;
              return { id, label: agg.label, percent, barPercent, resetLabel: agg.bestResetLabel, count: agg.count };
            })
            .sort((a, b) => a.label.localeCompare(b.label));
          return (
            <div className="flex flex-col gap-2">
              <div className="text-slate-500 dark:text-slate-400">Gemini CLI Quota</div>
              <div className="rounded border border-slate-200 dark:border-slate-700 p-2">
                {aggItems.length ? (
                  <div className="flex flex-col gap-1">
                    {aggItems.map((it) => {
                      const bar = typeof it.barPercent === 'number' ? Math.max(0, Math.min(100, it.barPercent)) : null;
                      const tone = bar === null
                        ? 'bg-slate-200 dark:bg-slate-700'
                        : bar >= 60
                          ? 'bg-emerald-500'
                          : bar >= 20
                            ? 'bg-amber-500'
                            : 'bg-rose-500';
                      const label = it.percent === null
                        ? '-'
                        : showAverage
                          ? `${bar === null ? '-' : `${Math.round(bar)}%`}`
                          : `${Math.round(it.percent)}%`;
                      return (
                        <div key={it.id} className="flex flex-col gap-0.5" title={showAverage ? `${it.count} subscriptions` : undefined}>
                          <div className="flex items-center justify-between gap-2">
                            <span className="truncate">{it.label}</span>
                            <span className="font-mono tabular-nums text-slate-400">{label} · {it.resetLabel}</span>
                          </div>
                          <div className="h-1.5 w-full rounded bg-slate-100 dark:bg-slate-800 overflow-hidden">
                            <div
                              className={`h-full ${tone}`}
                              style={{ width: `${bar === null ? 0 : bar}%` }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="text-slate-400">No quota data</div>
                )}
                <div className="mt-1 text-[10px] text-slate-400">{files.length} subscriptions</div>
              </div>
            </div>
          );
        })()}

        {(() => {
          const files = authFiles.filter((f) => normalizeCliproxyProviderKey(f.provider ?? null) === 'antigravity' && !f.runtimeOnly);
          if (files.length === 0) return (
            <div className="text-slate-400">Antigravity Quota: no auth files</div>
          );
          const fileLabel = (file: CliproxyAuthFile) => file.email ?? file.label ?? file.name ?? file.id;
          if (!showAverage) {
            const entries = files
              .map((file) => {
                const quota = quotas.antigravity?.[file.id];
                const items = (quota?.items ?? []).slice().sort((a, b) => a.label.localeCompare(b.label));
                return {
                  id: file.id,
                  label: fileLabel(file),
                  items: items.map((it) => ({
                    id: it.id,
                    label: it.label,
                    percent: typeof it.remainingPercent === 'number' ? Math.max(0, Math.min(100, it.remainingPercent)) : null,
                    resetLabel: it.resetLabel ?? '-',
                  })),
                };
              })
              .sort((a, b) => a.label.localeCompare(b.label));
            return (
              <div className="flex flex-col gap-2">
                <div className="text-slate-500 dark:text-slate-400">Antigravity Quota</div>
                <div className="rounded border border-slate-200 dark:border-slate-700 p-2">
                  <div className="flex flex-col gap-2">
                    {entries.map((e) => (
                      <div key={e.id} className="flex flex-col gap-1 pb-2 border-b border-slate-200/60 dark:border-slate-700/60 last:border-b-0 last:pb-0">
                        <div className="truncate">{e.label}</div>
                        <div className="flex flex-col gap-1">
                          {e.items.map((it) => {
                            const percent = typeof it.percent === 'number' ? Math.max(0, Math.min(100, it.percent)) : null;
                            const tone = percent === null
                              ? 'bg-slate-200 dark:bg-slate-700'
                              : percent >= 60
                                ? 'bg-emerald-500'
                                : percent >= 20
                                  ? 'bg-amber-500'
                                  : 'bg-rose-500';
                            return (
                              <div key={it.id} className="flex flex-col gap-0.5">
                                <div className="flex items-center justify-between gap-2">
                                  <span className="truncate">{it.label}</span>
                                  <span className="font-mono tabular-nums text-slate-400">{percent === null ? '-' : `${Math.round(percent)}%`} · {it.resetLabel}</span>
                                </div>
                                <div className="h-1.5 w-full rounded bg-slate-100 dark:bg-slate-800 overflow-hidden">
                                  <div
                                    className={`h-full ${tone}`}
                                    style={{ width: `${percent === null ? 0 : percent}%` }}
                                  />
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="mt-1 text-[10px] text-slate-400">{files.length} subscriptions</div>
                </div>
              </div>
            );
          }
          const aggByItemId = new Map<string, {
            label: string;
            bestRemaining: number | null;
            bestResetLabel: string;
            sumRemaining: number;
            count: number;
          }>();
          files.forEach((file) => {
            const quota = quotas.antigravity?.[file.id];
            const items = quota?.items ?? [];
            items.forEach((it) => {
              if (!it?.id) return;
              const percent = typeof it.remainingPercent === 'number' ? Math.max(0, Math.min(100, it.remainingPercent)) : null;
              const prev = aggByItemId.get(it.id) ?? {
                label: it.label,
                bestRemaining: null,
                bestResetLabel: '-',
                sumRemaining: 0,
                count: 0,
              };
              if (percent !== null) {
                prev.sumRemaining += percent;
                prev.count += 1;
              }
              if (
                percent !== null
                && (prev.bestRemaining === null || percent > prev.bestRemaining)
              ) {
                prev.bestRemaining = percent;
                prev.bestResetLabel = it.resetLabel;
                prev.label = it.label;
              } else if (prev.bestResetLabel === '-' && it.resetLabel !== '-') {
                prev.bestResetLabel = it.resetLabel;
              }
              aggByItemId.set(it.id, prev);
            });
          });
          const aggItems = Array.from(aggByItemId.entries())
            .map(([id, agg]) => {
              const percent = showAverage ? (agg.count > 0 ? agg.sumRemaining : null) : agg.bestRemaining;
              const barPercent = showAverage ? (agg.count > 0 ? agg.sumRemaining / agg.count : null) : percent;
              return { id, label: agg.label, percent, barPercent, resetLabel: agg.bestResetLabel, count: agg.count };
            })
            .sort((a, b) => a.label.localeCompare(b.label));
          return (
            <div className="flex flex-col gap-2">
              <div className="text-slate-500 dark:text-slate-400">Antigravity Quota</div>
              <div className="rounded border border-slate-200 dark:border-slate-700 p-2">
                {aggItems.length ? (
                  <div className="flex flex-col gap-1">
                    {aggItems.map((it) => {
                      const bar = typeof it.barPercent === 'number' ? Math.max(0, Math.min(100, it.barPercent)) : null;
                      const tone = bar === null
                        ? 'bg-slate-200 dark:bg-slate-700'
                        : bar >= 60
                          ? 'bg-emerald-500'
                          : bar >= 20
                            ? 'bg-amber-500'
                            : 'bg-rose-500';
                      const label = it.percent === null
                        ? '-'
                        : showAverage
                          ? `${bar === null ? '-' : `${Math.round(bar)}%`}`
                          : `${Math.round(it.percent)}%`;
                      return (
                        <div key={it.id} className="flex flex-col gap-0.5" title={showAverage ? `${it.count} subscriptions` : undefined}>
                          <div className="flex items-center justify-between gap-2">
                            <span className="truncate">{it.label}</span>
                            <span className="font-mono tabular-nums text-slate-400">{label} · {it.resetLabel}</span>
                          </div>
                          <div className="h-1.5 w-full rounded bg-slate-100 dark:bg-slate-800 overflow-hidden">
                            <div
                              className={`h-full ${tone}`}
                              style={{ width: `${bar === null ? 0 : bar}%` }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="text-slate-400">No quota data</div>
                )}
                <div className="mt-1 text-[10px] text-slate-400">{files.length} subscriptions</div>
              </div>
            </div>
          );
        })()}
      </div>

      {quotas.updatedAt ? (
        <div className="text-slate-400">updated {formatMonthDayTime(new Date(quotas.updatedAt))}</div>
      ) : null}
    </div>
  );
};
