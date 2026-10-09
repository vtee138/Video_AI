import React from 'react';
import {AbsoluteFill, Audio, interpolate, OffthreadVideo, Sequence, staticFile, useCurrentFrame} from 'remotion';
import '@fontsource/be-vietnam-pro/600.css';
import '@fontsource/be-vietnam-pro/700.css';
import '@fontsource/be-vietnam-pro/800.css';
import '@fontsource/be-vietnam-pro/900.css';
import 'flag-icons/css/flag-icons.min.css';

const ink = '#fffdf7';
const accent = '#ffd35c';
const clipFrames = 45;
const sceneCount = 20;

const iconPaths = {
  country: <><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/></>,
  city: <><path d="M4 21V8l6-3v16M10 21V3l10 4v14M2 21h20"/><path d="M7 11h1M7 15h1M14 9h2M14 13h2M14 17h2"/></>,
  company: <><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 5V3h8v2M3 11h18M9 15h6"/></>,
  person: <><circle cx="12" cy="7" r="4"/><path d="M4 21c0-5 3-8 8-8s8 3 8 8"/></>,
  product: <><path d="m4 7 8-4 8 4-8 4-8-4Z"/><path d="M4 7v10l8 4 8-4V7M12 11v10"/></>,
  nature: <><path d="M20 4C11 4 5 8 5 15c0 3 2 5 5 5 7 0 10-7 10-16Z"/><path d="M4 21c3-5 7-8 12-11"/></>,
  sport: <><circle cx="12" cy="12" r="9"/><path d="m9 8 3-2 3 2-1 4h-4L9 8ZM10 12l-3 3M14 12l3 3M8 19l-1-4M16 19l1-4"/></>,
  money: <><circle cx="12" cy="12" r="9"/><path d="M15 8.5c-.7-1-1.7-1.5-3-1.5-1.7 0-3 1-3 2.4 0 3.6 6 1.4 6 5 0 1.5-1.3 2.6-3.2 2.6-1.4 0-2.6-.5-3.4-1.6M12 5v14"/></>,
  technology: <><rect x="4" y="4" width="16" height="16" rx="3"/><path d="M9 9h6v6H9zM9 1v3M15 1v3M9 20v3M15 20v3M1 9h3M1 15h3M20 9h3M20 15h3"/></>,
  generic: <path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9L12 3Z"/>,
};

function EntityIcon({type = 'generic'}) {
  return <div style={{width: 46, height: 34, flexShrink: 0, borderRadius: 8,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    border: '1px solid rgba(255,255,255,.55)', background: 'rgba(0,0,0,.34)', color: accent}}>
    <svg width="27" height="27" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {iconPaths[type] || iconPaths.generic}
    </svg>
  </div>;
}

function RowVisual({item, entityType}) {
  const code = String(item.countryCode || '').toLowerCase();
  if (code) {
    return <span className={`fi fi-${code}`} style={{width: 46, height: 34, flexShrink: 0,
      borderRadius: 6, boxShadow: '0 2px 8px rgba(0,0,0,.55)',
      border: '1px solid rgba(255,255,255,.72)'}} />;
  }
  return <EntityIcon type={entityType} />;
}

function FootageScene({src, index, occurrence}) {
  const frame = useCurrentFrame();
  const scale = interpolate(frame, [0, clipFrames], [1.03, 1.1], {extrapolateRight: 'clamp'});
  const positions = ['50% 50%', '42% 50%', '58% 48%', '50% 42%'];
  return <OffthreadVideo
    src={staticFile(src)}
    muted
    playbackRate={1.5}
    trimBefore={occurrence * 75}
    style={{width: '100%', height: '100%', objectFit: 'cover', objectPosition: positions[index % positions.length],
      transform: `scale(${scale})`, filter: 'brightness(1.05) saturate(1.04) contrast(1.02)'}}
  />;
}

function Background({clips = []}) {
  return <AbsoluteFill style={{background: 'linear-gradient(160deg,#142238,#05080e)'}}>
    {clips.length > 0 && Array.from({length: sceneCount}, (_, index) => (
      <Sequence key={index} from={index * clipFrames} durationInFrames={clipFrames}>
        <FootageScene src={clips[index % clips.length]} index={index}
          occurrence={Math.floor(index / clips.length)} />
      </Sequence>
    ))}
    <AbsoluteFill style={{background: 'linear-gradient(180deg,rgba(0,0,0,.58) 0%,rgba(0,0,0,.1) 28%,rgba(0,0,0,.18) 72%,rgba(0,0,0,.52) 100%)'}} />
    <AbsoluteFill style={{background: 'linear-gradient(90deg,rgba(0,0,0,.22),rgba(0,0,0,.06) 75%,rgba(0,0,0,.2))'}} />
  </AbsoluteFill>;
}

function RankingRow({item, entityType}) {
  const entitySize = item.entity.length > 18 ? 32 : item.entity.length > 13 ? 35 : 39;
  const valueSize = item.displayValue.length > 18 ? 28 : item.displayValue.length > 14 ? 31 : 35;
  return <div style={{
    height: 106,
    display: 'flex',
    alignItems: 'center',
    gap: 14,
    padding: '0 22px 0 17px',
    borderBottom: '1px solid rgba(255,255,255,.23)',
    background: item.rank === 1 ? 'rgba(255,211,92,.16)' : 'rgba(0,0,0,.19)',
  }}>
    <div style={{width: 54, flexShrink: 0, textAlign: 'right', color: item.rank <= 3 ? accent : ink,
      fontSize: 39, fontWeight: 900}}>{item.rank}.</div>
    <RowVisual item={item} entityType={entityType} />
    <div style={{flex: 1, minWidth: 0, fontSize: entitySize, fontWeight: 850, whiteSpace: 'nowrap',
      overflow: 'hidden', textOverflow: 'ellipsis'}}>{item.entity}</div>
    <div style={{maxWidth: 330, flexShrink: 0, textAlign: 'right', color: item.rank === 1 ? accent : ink,
      fontSize: valueSize, fontWeight: 800, whiteSpace: 'nowrap'}}>{item.displayValue}</div>
  </div>;
}

export function RankingVideo({spec}) {
  const titleSize = spec.title.length > 42 ? 49 : spec.title.length > 30 ? 55 : 60;
  return <AbsoluteFill style={{fontFamily: '"Be Vietnam Pro", Arial, sans-serif', color: ink}}>
    <Background clips={spec.backgroundClips} />
    {spec.musicPath && <Audio
      src={staticFile(spec.musicPath)}
      loop
      volume={(audioFrame) => 0.2 * Math.max(0, Math.min(1, audioFrame / 20, (900 - audioFrame) / 30))}
    />}

    <div style={{position: 'absolute', left: 62, right: 130, top: 150,
      textAlign: 'center', textShadow: '0 3px 2px #000, 0 8px 28px rgba(0,0,0,.9)'}}>
      <div style={{fontSize: titleSize, lineHeight: 1.05, fontWeight: 950, textTransform: 'uppercase',
        letterSpacing: -1.8, WebkitTextStroke: '1.2px rgba(0,0,0,.85)'}}>{spec.title}</div>
      <div style={{fontSize: 29, lineHeight: 1.2, fontWeight: 700, marginTop: 18,
        color: 'rgba(255,255,255,.88)'}}>{spec.subtitle}</div>
    </div>

    <div style={{position: 'absolute', left: 64, right: 132, top: 390,
      borderRadius: 24, overflow: 'hidden', border: '1px solid rgba(255,255,255,.25)',
      boxShadow: '0 18px 55px rgba(0,0,0,.48)',
      textShadow: '0 2px 2px #000, 0 4px 12px rgba(0,0,0,.9)'}}>
      {spec.rows.map(item => <RankingRow key={`${item.rank}-${item.entity}`} item={item} entityType={spec.entityType} />)}
    </div>

    <div style={{position: 'absolute', left: 74, right: 150, top: 1500,
      borderTop: '2px solid rgba(255,255,255,.55)', paddingTop: 18,
      fontSize: 25, lineHeight: 1.25, fontWeight: 650, color: 'rgba(255,255,255,.86)',
      textShadow: '0 2px 8px #000', overflowWrap: 'anywhere'}}>
      Nguồn: {spec.sourceText}
    </div>
  </AbsoluteFill>;
}
