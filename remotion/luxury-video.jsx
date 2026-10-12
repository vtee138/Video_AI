import React from 'react';
import {AbsoluteFill, Audio, interpolate, OffthreadVideo, Sequence, staticFile, useCurrentFrame} from 'remotion';

// Alternating lengths keep eight cuts evenly spaced across exactly 900 frames.
const lengths = [112, 113, 112, 113, 112, 113, 112, 113];
const starts = lengths.map((_, index) => lengths.slice(0, index).reduce((sum, value) => sum + value, 0));

function Scene({src, duration}) {
  const frame = useCurrentFrame();
  const scale = interpolate(frame, [0, duration], [1.025, 1.085]);
  return <AbsoluteFill style={{backgroundColor: '#08090b', overflow: 'hidden'}}>
    {src && <OffthreadVideo src={staticFile(src)} muted
      style={{width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center',
        transform: `scale(${scale})`, filter: 'saturate(.94) contrast(1.03)'}} />}
  </AbsoluteFill>;
}

export function LuxuryVideo({spec}) {
  return <AbsoluteFill style={{backgroundColor: '#08090b'}}>
    {lengths.map((duration, index) => <Sequence key={index} from={starts[index]} durationInFrames={duration}>
      <Scene src={spec.backgroundClips?.[index]} duration={duration} />
    </Sequence>)}
    {spec.musicPath && <Audio src={staticFile(spec.musicPath)} loop
      volume={frame => .62 * Math.min(1, frame / 18, (900 - frame) / 30)} />}
    {spec.sfxPath && starts.slice(1).map((start, index) => <Sequence key={`sfx-${index}`}
      from={start - 2} durationInFrames={18}>
      <Audio src={staticFile(spec.sfxPath)} volume={0.16} />
    </Sequence>)}
  </AbsoluteFill>;
}
