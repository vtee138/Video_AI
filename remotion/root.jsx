import React from 'react';
import {Composition} from 'remotion';
import {RankingVideo} from './video.jsx';
import {QuoteVideo} from './quote-video.jsx';

const sample = {type: 'ranking', title: 'TOP 10 NỀN KINH TẾ LỚN NHẤT', subtitle: 'GDP danh nghĩa · 2025 (ước tính)',
  entityType: 'country',
  sourceText: 'Nguồn dữ liệu trong research.json',
  rows: Array.from({length: 10}, (_, i) => ({rank: i + 1, entity: `Quốc gia ${i + 1}`,
    countryCode: ['US', 'CN', 'DE', 'IN', 'JP', 'GB', 'FR', 'IT', 'BR', 'CA'][i],
    displayValue: `${30 - i * 2} nghìn tỷ USD`})),
  backgroundClips: [], musicPath: null};
const quoteSample = {type: 'quote', mode: 'caption', title: 'Giữ lời khi công việc khó',
  quoteText: '', hookText: 'Lúc công việc khó nhất mới biết một lời hứa có giá trị đến đâu.',
  backgroundImage: null, musicPath: null, duration: 35};

export const Root = () => <>
  <Composition id="RankingVideo" component={RankingVideo}
    width={1080} height={1920} fps={30} durationInFrames={900} defaultProps={{spec: sample}} />
  <Composition id="QuoteVideo" component={QuoteVideo}
    width={1080} height={1920} fps={30} durationInFrames={1050} defaultProps={{spec: quoteSample}}
    calculateMetadata={({props}) => ({durationInFrames: Math.round((props.spec.duration || 35) * 30)})} />
</>;
