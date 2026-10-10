import React from 'react';
import openaiSvg from '@lobehub/icons-static-svg/icons/openai.svg?raw';
import claudeSvg from '@lobehub/icons-static-svg/icons/claude-color.svg?raw';
import geminiSvg from '@lobehub/icons-static-svg/icons/gemini-color.svg?raw';
import googleSvg from '@lobehub/icons-static-svg/icons/google-color.svg?raw';
import openrouterSvg from '@lobehub/icons-static-svg/icons/openrouter.svg?raw';
import qwenSvg from '@lobehub/icons-static-svg/icons/qwen-color.svg?raw';
import mistralSvg from '@lobehub/icons-static-svg/icons/mistral-color.svg?raw';
import metaSvg from '@lobehub/icons-static-svg/icons/meta-brand-color.svg?raw';
import cohereSvg from '@lobehub/icons-static-svg/icons/cohere-color.svg?raw';
import xaiSvg from '@lobehub/icons-static-svg/icons/xai.svg?raw';
import antigravitySvg from '../../assets/icons/antigravity.svg?raw';
import gptSvg from '../../assets/icons/gpt.svg?raw';
import type { ModelFamilyKey } from '../../utils/aiModelUtils';

export type AvatarKey =
  | ModelFamilyKey
  | 'antigravity'
  | 'google'
  | 'openai'
  | 'openrouter'
  | 'opencode-go'
  | 'chatgpt'
  | 'codex'
  | 'gemini-cli'
  | 'anthropic'
  | 'qwen'
  | 'mistral'
  | 'meta'
  | 'cohere'
  | 'xai';

export type AvatarTooltipHandlers = {
  onMouseEnter?: (event: React.MouseEvent<HTMLSpanElement>) => void;
  onMouseMove?: (event: React.MouseEvent<HTMLSpanElement>) => void;
  onMouseLeave?: () => void;
};

export const getAvatarForKey = (key: AvatarKey) => {
  if (key === 'opencode-go') {
    return { kind: 'text', label: 'OpenCode Go' };
  }
  if (key === 'chatgpt') {
    return { kind: 'svg', svg: openaiSvg, className: 'text-slate-900 dark:text-slate-100', label: 'ChatGPT' };
  }
  if (key === 'antigravity') {
    return { kind: 'svg', svg: antigravitySvg, className: 'text-slate-700 dark:text-slate-300', label: 'Antigravity' };
  }
  if (key === 'google') {
    return { kind: 'svg', svg: googleSvg, label: 'Google' };
  }
  if (key === 'gemini-cli') {
    return { kind: 'svg', svg: googleSvg, label: 'Gemini CLI' };
  }
  if (key === 'claude') {
    return { kind: 'svg', svg: claudeSvg, label: 'Anthropic' };
  }
  if (key === 'anthropic') {
    return { kind: 'svg', svg: claudeSvg, label: 'Anthropic' };
  }
  if (key === 'gemini') {
    return { kind: 'svg', svg: geminiSvg, label: 'Gemini' };
  }
  if (key === 'openai') {
    return { kind: 'svg', svg: openaiSvg, className: 'text-slate-900 dark:text-slate-100', label: 'OpenAI' };
  }
  if (key === 'codex') {
    return { kind: 'svg', svg: openaiSvg, className: 'text-slate-900 dark:text-slate-100', label: 'Codex CLI' };
  }
  if (key === 'openrouter') {
    return { kind: 'svg', svg: openrouterSvg, className: 'text-slate-900 dark:text-slate-100', label: 'OpenRouter' };
  }
  if (key === 'gpt') {
    return { kind: 'svg', svg: gptSvg, className: 'text-slate-900 dark:text-slate-400', label: 'GPT' };
  }
  if (key === 'qwen') {
    return { kind: 'svg', svg: qwenSvg, label: 'Qwen' };
  }
  if (key === 'mistral') {
    return { kind: 'svg', svg: mistralSvg, label: 'Mistral' };
  }
  if (key === 'meta') {
    return { kind: 'svg', svg: metaSvg, label: 'Meta' };
  }
  if (key === 'cohere') {
    return { kind: 'svg', svg: cohereSvg, label: 'Cohere' };
  }
  if (key === 'xai') {
    return { kind: 'svg', svg: xaiSvg, label: 'xAI' };
  }
  return { kind: 'text', label: 'LLM' };
};

export const AiAvatar: React.FC<{ avatar: ReturnType<typeof getAvatarForKey>; tooltipHandlers?: AvatarTooltipHandlers }> = ({
  avatar,
  tooltipHandlers,
}) => {
  if (avatar.kind === 'svg') {
    const svgMarkup = (() => {
      const raw = avatar.svg.trim();
      if (!raw.startsWith('<svg')) return raw;
      if (raw.includes('data-avatar="1"')) return raw;
      if (raw.includes('style="')) {
        return raw.replace('style="', 'style="width:100%;height:100%;display:block;');
      }
      return raw.replace('<svg ', '<svg data-avatar="1" style="width:100%;height:100%;display:block;" ');
    })();
    return (
      <span
        className={`inline-flex h-4 w-4 items-center justify-center rounded-full border border-slate-200/70 bg-slate-50 text-[14px] shadow-sm dark:border-slate-700/70 dark:bg-slate-800 ${avatar.className ?? ''}`}
        aria-label={avatar.label}
        title={avatar.label}
        {...tooltipHandlers}
        dangerouslySetInnerHTML={{ __html: svgMarkup }}
      />
    );
  }
  return (
    <span
      className="inline-flex h-4 px-1.5 items-center justify-center rounded-full text-[8px] font-semibold tracking-tight bg-slate-500/20 text-slate-600 dark:text-slate-300"
      title={avatar.label}
      {...tooltipHandlers}
    >
      {avatar.label}
    </span>
  );
};
