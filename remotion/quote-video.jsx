import React from 'react';
import {AbsoluteFill, Audio, Img, interpolate, OffthreadVideo, Sequence, staticFile,
  useCurrentFrame, useVideoConfig} from 'remotion';
import '@fontsource/be-vietnam-pro/400.css';
import '@fontsource/be-vietnam-pro/600.css';
import '@fontsource/be-vietnam-pro/700.css';
import '@fontsource/be-vietnam-pro/800.css';

const sceneFrames = 45;

function QuoteFootage({src, index, occurrence}) {
  const frame = useCurrentFrame();
  const scale = interpolate(frame, [0, sceneFrames], [1.04, 1.12], {extrapolateRight: 'clamp'});
  const positions = ['50% 50%', '44% 52%', '58% 48%', '50% 42%'];
  return <OffthreadVideo src={staticFile(src)} muted playbackRate={1.5}
    trimBefore={(occurrence % 3) * 15}
    style={{width: '100%', height: '100%', objectFit: 'cover',
      objectPosition: positions[index % positions.length], transform: `scale(${scale})`,
      filter: 'brightness(.98) saturate(1.04) contrast(1.08)'}} />;
}

function CinematicBackground({clips = [], image}) {
  const frame = useCurrentFrame();
  const {durationInFrames} = useVideoConfig();
  const count = Math.ceil(durationInFrames / sceneFrames);
  const reveal = interpolate(frame, [0, 36], [0, 1], {extrapolateRight: 'clamp'});
  const imageScale = interpolate(frame, [0, 42, durationInFrames], [1.17, 1.055, 1.095],
    {extrapolateRight: 'clamp'});
  const driftX = Math.sin(frame / 115) * 17;
  const driftY = Math.sin(frame / 155) * 12;
  const glowX = Math.sin(frame / 125) * 170;
  const glowY = Math.cos(frame / 180) * 80;
  const lightPass = interpolate(frame, [8, 22, 42, 58], [0, .22, .12, 0],
    {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  return <AbsoluteFill style={{background: 'linear-gradient(145deg,#171a22,#050608)'}}>
    {image ? <Img src={staticFile(image)} style={{width: '100%', height: '100%', objectFit: 'cover',
      transform: `translate3d(${driftX}px,${driftY}px,0) scale(${imageScale})`, transformOrigin: '50% 44%',
      filter: frame < 36 ? `blur(${(1 - reveal) * 9}px)` : undefined}} />
      : clips.length > 0 && Array.from({length: count}, (_, index) => (
      <Sequence key={index} from={index * sceneFrames}
        durationInFrames={Math.min(sceneFrames, durationInFrames - index * sceneFrames)}>
        <QuoteFootage src={clips[index % clips.length]} index={index}
          occurrence={Math.floor(index / clips.length)} />
      </Sequence>
    ))}
    {image ? <>
      <AbsoluteFill style={{background: '#03060a', opacity: interpolate(frame, [0, 8, 36],
        [.96, .82, .16], {extrapolateRight: 'clamp'})}} />
      <AbsoluteFill style={{background: 'linear-gradient(180deg,rgba(1,3,7,.25),transparent 39%,rgba(1,3,7,.45))'}} />
      <AbsoluteFill style={{background: 'radial-gradient(ellipse at 50% 43%,transparent 24%,rgba(1,3,7,.4) 100%)'}} />
      <AbsoluteFill style={{background: 'radial-gradient(ellipse 78% 63% at 48% 42%,rgba(215,229,245,.2),transparent 70%)',
        transform: `translate3d(${glowX}px,${glowY}px,0)`, opacity: .21}} />
      <AbsoluteFill style={{background: 'linear-gradient(108deg,transparent 27%,rgba(224,233,244,.22) 48%,transparent 67%)',
        opacity: lightPass,
        transform: `translateX(${interpolate(frame, [8, 58], [-95, 95],
          {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'})}%)`}} />
    </>
      : <>
        <AbsoluteFill style={{background: 'linear-gradient(180deg,rgba(2,3,5,.48),rgba(2,3,5,.12) 34%,rgba(2,3,5,.28) 68%,rgba(2,3,5,.68))'}} />
        <AbsoluteFill style={{background: 'radial-gradient(circle at 45% 42%,transparent 0%,rgba(0,0,0,.08) 42%,rgba(0,0,0,.58) 100%)'}} />
        <AbsoluteFill style={{opacity: .055 + (frame % 3) * .006,
          backgroundImage: 'repeating-radial-gradient(circle at 20% 30%,#fff 0 1px,transparent 1px 4px)',
          backgroundSize: '7px 7px', mixBlendMode: 'soft-light'}} />
      </>}
  </AbsoluteFill>;
}

function QuoteMark() {
  return <svg width="58" height="45" viewBox="0 0 58 45" aria-hidden="true">
    <path d="M3 41V25C3 10 11 2 27 1v9c-8 1-12 5-13 11h12v20H3Zm29 0V25C32 10 40 2 56 1v9c-8 1-12 5-13 11h12v20H32Z" fill="currentColor"/>
  </svg>;
}

export function QuoteVideo({spec}) {
  const frame = useCurrentFrame();
  const {durationInFrames} = useVideoConfig();
  const enter = interpolate(frame, spec.backgroundImage ? [22, 46] : [0, 14], [0, 1],
    {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  const exit = interpolate(frame, [durationInFrames - 18, durationInFrames - 2], [1, 0],
    {extrapolateLeft: 'clamp'});
  const visible = Math.min(enter, exit);
  const text = spec.mode === 'caption' ? spec.hookText : spec.quoteText;
  const length = text.length;
  const fontSize = spec.mode === 'caption' ? (length > 175 ? 39 : length > 145 ? 42 : length > 115 ? 44 : 48)
    : length > 270 ? 43 : length > 210 ? 48 : length > 150 ? 54 : 62;
  return <AbsoluteFill style={{fontFamily: '"Be Vietnam Pro", Arial, sans-serif', color: '#fffdf7'}}>
    <CinematicBackground clips={spec.backgroundClips} image={spec.backgroundImage} />
    {spec.musicPath && <Audio src={staticFile(spec.musicPath)} loop
      volume={(audioFrame) => .22 * Math.max(0, Math.min(1, audioFrame / 18,
        (durationInFrames - audioFrame) / 45))} />}

    {spec.mode === 'caption' ? <div style={{position: 'absolute', left: 65, right: 65, bottom: 370,
      display: 'flex', justifyContent: 'center', opacity: visible,
      transform: `translateY(${(1 - enter) * 18}px)`}}>
      <div style={{width: '100%', padding: '25px 31px', borderRadius: 10,
        background: 'rgba(211,56,61,.94)', boxShadow: '0 12px 30px rgba(0,0,0,.27)',
        color: '#fff', textAlign: 'center', fontSize, lineHeight: 1.25,
        fontWeight: 700, letterSpacing: '-.7px', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere',
        textShadow: '0 1px 2px rgba(0,0,0,.2)'}}>{text}</div>
    </div> : <div style={{position: 'absolute', left: 70, right: 148, top: 270, bottom: 330,
      display: 'flex', flexDirection: 'column', justifyContent: 'center',
      opacity: visible, transform: `translateY(${(1 - enter) * 24}px) scale(${.985 + enter * .015})`,
      textShadow: '0 3px 4px rgba(0,0,0,.95),0 14px 38px rgba(0,0,0,.82)'}}>
      <div style={{color: '#f2c94c', marginBottom: 30}}><QuoteMark /></div>
      <div style={{width: 70, height: 4, borderRadius: 2, background: '#f2c94c', marginBottom: 32}} />
      <div style={{fontSize, lineHeight: spec.mode === 'caption' ? 1.19 : 1.32,
        fontWeight: spec.mode === 'caption' ? 800 : 700, letterSpacing: '-1.2px',
        whiteSpace: 'pre-wrap', overflowWrap: 'anywhere'}}>{text}</div>
    </div>}

  </AbsoluteFill>;
}
