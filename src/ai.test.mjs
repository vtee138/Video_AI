import test from 'node:test';
import assert from 'node:assert/strict';

process.env.AI_PROVIDER = 'gemini';
process.env.GEMINI_API_KEY = 'test-key';
process.env.GEMINI_MODEL = 'gemini-test-main';
process.env.GEMINI_SEARCH_MODEL = 'gemini-test-search';
process.env.GEMINI_QUOTE_MODEL = 'gemini-test-quote';
const {brainstorm, brainstormQuotes, discoverSuperTopic, writeStory} = await import('./ai.mjs');

const year = new Intl.DateTimeFormat('en', {timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric'}).format(new Date());
const ideas = Array.from({length: 3}, (_, index) => ({title: `Idea ${index}`, metric: 'Population',
  latestPeriod: year, dataStatus: 'actual', description: '', whyInteresting: '',
  suggestedSources: ['https://example.org/data'], dataAvailability: 1, viralPotential: 1, surprisePotential: 1}));

test('Gemini research requests search grounding and structured JSON', async () => {
  const originalFetch = globalThis.fetch;
  let request;
  globalThis.fetch = async (url, options) => {
    request = {url, options, body: JSON.parse(options.body)};
    return new Response(JSON.stringify({candidates: [{content: {parts: [{text: JSON.stringify({ideas})}]},
      groundingMetadata: {webSearchQueries: ['population ranking']}}]}),
    {status: 200, headers: {'Content-Type': 'application/json'}});
  };
  try {
    assert.equal((await brainstorm('population')).length, 3);
    assert.equal(request.url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-test-search:generateContent');
    assert.equal(request.options.headers['x-goog-api-key'], 'test-key');
    assert.deepEqual(request.body.tools, [{google_search: {}}]);
    assert.equal(request.body.generationConfig.responseMimeType, 'application/json');
    assert.equal(request.body.model, undefined);
  } finally { globalThis.fetch = originalFetch; }
});

test('Gemini research rejects an ungrounded response', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({candidates: [{content: {parts: [{text: JSON.stringify({ideas})}]}}]}),
    {status: 200, headers: {'Content-Type': 'application/json'}});
  try {
    await assert.rejects(brainstorm('population'), /Google Search/);
  } finally { globalThis.fetch = originalFetch; }
});

test('Super Auto finds a fresh Ranking topic with search and rejects a repeat', async () => {
  const originalFetch = globalThis.fetch;
  let request;
  globalThis.fetch = async (_url, options) => {
    request = JSON.parse(options.body);
    return new Response(JSON.stringify({candidates: [{content: {parts: [{text: JSON.stringify({
      topic: 'Các thành phố đón nhiều khách quốc tế nhất', reason: 'Dữ liệu mới',
    })}]}, groundingMetadata: {webSearchQueries: ['tourism data']}}]}), {status: 200});
  };
  try {
    assert.equal(await discoverSuperTopic({template: 'ranking', focus: 'du lịch', recent: []}),
      'Các thành phố đón nhiều khách quốc tế nhất');
    assert.deepEqual(request.tools, [{google_search: {}}]);
    await assert.rejects(discoverSuperTopic({template: 'ranking', focus: 'du lịch',
      recent: ['Các thành phố đón nhiều khách quốc tế nhất']}), /chủ đề mới/);
  } finally { globalThis.fetch = originalFetch; }
});

test('Super Auto chooses an original Quote topic without web search', async () => {
  const originalFetch = globalThis.fetch;
  let request;
  globalThis.fetch = async (_url, options) => {
    request = JSON.parse(options.body);
    return new Response(JSON.stringify({candidates: [{content: {parts: [{text: JSON.stringify({
      topic: 'Giữ lời khi công việc không thuận lợi', reason: 'Góc nhìn đời thực',
    })}]}}]}), {status: 200});
  };
  try {
    assert.match(await discoverSuperTopic({template: 'quote', recent: []}), /Giữ lời/);
    assert.equal(request.tools, undefined);
    assert.match(request.contents[0].parts[0].text, /chọn người, cắt lỗ/);
  } finally { globalThis.fetch = originalFetch; }
});

test('Quote tạo đúng 8 nội dung và không bật Google Search', async () => {
  const originalFetch = globalThis.fetch;
  let request, requestUrl;
  const hookText = 'Đừng nuốt lời hứa giao hàng rồi im lặng. Khách mất thời gian, đội bán hàng mất mặt, còn uy tín bị đem ra trả nợ.';
  const captionText = Array.from({length: 5}, (_, index) =>
    `${index + 1}. Giữ lời với khách hàng là một phần của uy tín. Việc nhỏ sai hạn cũng có giá của nó, nên hứa đúng khả năng và báo sớm khi không thể giao đúng.`).join('\n\n');
  const quoteIdeas = Array.from({length: 8}, (_, index) => ({title: `Quote ${index + 1}`,
    quoteText: '', hookText, captionText,
    hashtags: ['kinhdoanh', 'kyluat', 'trachnhiem']}));
  globalThis.fetch = async (url, options) => {
    requestUrl = url;
    request = JSON.parse(options.body);
    return new Response(JSON.stringify({candidates: [{content: {parts: [{text: JSON.stringify({ideas: quoteIdeas})}]}}]}),
      {status: 200, headers: {'Content-Type': 'application/json'}});
  };
  try {
    assert.equal((await brainstormQuotes('kỷ luật', 'caption')).length, 8);
    assert.equal(request.tools, undefined);
    const instruction = request.contents[0].parts[0].text;
    assert.match(instruction, /triết lý sắc, lạnh và thực dụng/);
    assert.match(instruction, /Tránh giọng chữa lành/);
    assert.match(instruction, /Bám sát chủ đề người dùng nhập/);
    assert.match(instruction, /Nội dung chính nằm trong caption/);
    assert.match(instruction, /ĐÚNG 5 mục đánh số 1\. đến 5\./);
    assert.match(instruction, /Cắt lỗ > Kiên trì/);
    assert.match(instruction, /Giữ người sai việc/);
    assert.match(instruction, /nhân văn sáo, văn sách giáo khoa/);
    assert.match(instruction, /Không bịa trải nghiệm cá nhân/);
    assert.match(instruction, /CÂU ĐẦU PHẢI ĐẬP VÀO MẮT/);
    assert.match(instruction, /không xưng hô/);
    assert.match(instruction, /đọc trong khoảng 5 giây trên ảnh/);
    assert.match(requestUrl, /models\/gemini-test-quote:generateContent$/);
  } finally { globalThis.fetch = originalFetch; }
});

test('Quote tự sửa riêng caption sai cấu trúc và giữ 7 ý tưởng hợp lệ', async () => {
  const originalFetch = globalThis.fetch;
  const hookText = 'Đừng nuốt lời hứa giao hàng rồi im lặng. Khách mất thời gian, đội bán hàng mất mặt, còn uy tín bị đem ra trả nợ.';
  const captionText = Array.from({length: 5}, (_, index) =>
    `${index + 1}. Khi đã nhận việc thì hãy nói rõ thời hạn có thể giao. Nếu bị trễ, báo trước để người khác còn kịp xoay xở thay vì đợi họ phải hỏi.`).join('\n\n');
  const valid = index => ({title: `Quote ${index + 1}`, quoteText: '',
    hookText, captionText,
    hashtags: ['kinhdoanh', 'kyluat', 'trachnhiem']});
  const ideas = Array.from({length: 8}, (_, index) => valid(index));
  ideas[3] = {...ideas[3], captionText: 'Một đoạn không đánh số.'};
  const requests = [];
  globalThis.fetch = async (_url, options) => {
    const request = JSON.parse(options.body);
    requests.push(request);
    const payload = requests.length === 1 ? {ideas} : valid(3);
    return new Response(JSON.stringify({candidates: [{content: {parts: [{text: JSON.stringify(payload)}]}}]}),
      {status: 200, headers: {'Content-Type': 'application/json'}});
  };
  try {
    const result = await brainstormQuotes('giữ lời hứa', 'caption');
    assert.equal(requests.length, 2);
    assert.equal(result.length, 8);
    assert.deepEqual(result[0], ideas[0]);
    assert.equal(result[3].captionText, captionText);
    assert.match(requests[1].contents[0].parts[0].text, /phương án số 4/);
    assert.ok(requests[1].generationConfig.responseSchema.properties.captionText);
  } finally { globalThis.fetch = originalFetch; }
});

test('Quote tự sửa hook hỏi, mở yếu, xưng hô hoặc bịa tỷ lệ', async () => {
  const originalFetch = globalThis.fetch;
  const hookText = 'Đừng nuốt lời hứa giao hàng rồi im lặng. Khách mất thời gian, đội bán hàng mất mặt, còn uy tín bị đem ra trả nợ.';
  const captionText = Array.from({length: 5}, (_, index) =>
    `${index + 1}. Một lời hứa bị phá có giá của nó. Khách hàng phải xoay xở khi hàng đến muộn, còn đội bán hàng mất thời gian giải thích thay vì chốt việc mới.`).join('\n\n');
  const invalidHooks = [
    'Ai trả giá khi người đứng đầu giữ người sai việc chỉ vì sợ mất lòng? Cả đội phải gánh phần việc bị bỏ dở, còn khách hàng mất niềm tin vào lời hứa giao hàng.',
    'Hãy loại người sai việc ra khỏi đội trước khi toàn bộ tiến độ sụp đổ. Một quyết định chậm có thể làm người giỏi phải gánh phần việc không thuộc về họ.',
    'Giữ người sai việc vì sợ mất lòng là cách bạn bắt cả đội trả giá cho sự yếu tay. Người giỏi phải gánh thêm việc, còn khách hàng phải chờ câu trả lời.',
    'Không phải ngẫu nhiên mà chỉ 10% người đứng đầu dám loại người sai việc. Phần còn lại để người giỏi gánh thêm việc và khách hàng chờ.',
    'Thói quen nghe lời xu nịnh khiến người đứng đầu cắt mất đường phản biện của cả đội. Kẻ giỏi nói điều dễ nghe được cầm lái thay người có năng lực.'
  ];
  try {
    for (const invalidHook of invalidHooks) {
      const valid = index => ({title: `Quote ${index + 1}`, quoteText: '', hookText, captionText,
        hashtags: ['kinhdoanh', 'kyluat', 'trachnhiem']});
      const ideas = Array.from({length: 8}, (_, index) => valid(index));
      ideas[0] = {...ideas[0], hookText: invalidHook};
      const requests = [];
      globalThis.fetch = async (_url, options) => {
        requests.push(JSON.parse(options.body));
        const payload = requests.length === 1 ? {ideas} : valid(0);
        return new Response(JSON.stringify({candidates: [{content: {parts: [{text: JSON.stringify(payload)}]}}]}),
          {status: 200, headers: {'Content-Type': 'application/json'}});
      };
      const result = await brainstormQuotes('lãnh đạo', 'caption');
      assert.equal(requests.length, 2, invalidHook);
      assert.equal(result[0].hookText, hookText);
      assert.deepEqual(result[1], ideas[1]);
    }
  } finally { globalThis.fetch = originalFetch; }
});

test('Story uses Google AI Studio with a structured schema', async () => {
  const originalFetch = globalThis.fetch;
  let requestUrl, request;
  globalThis.fetch = async (url, options) => {
    requestUrl = url;
    request = JSON.parse(options.body);
    return new Response(JSON.stringify({candidates: [{content: {parts: [{text: JSON.stringify({title: 'Story'})}]}}]}),
      {status: 200, headers: {'Content-Type': 'application/json'}});
  };
  try {
    assert.equal((await writeStory({}, {}, [])).title, 'Story');
    assert.match(requestUrl, /models\/gemini-test-main:generateContent$/);
    assert.equal(request.tools, undefined);
    assert.equal(request.generationConfig.responseSchema.type, 'object');
    assert.ok(request.generationConfig.responseSchema.properties.hookText);
    assert.match(request.contents[0].parts[0].text, /top 10 ĐÃ KIỂM TRA/);
  } finally { globalThis.fetch = originalFetch; }
});

test('OmniRouter uses its saved key, active model, and Chat Completions schema', async () => {
  const originalFetch = globalThis.fetch;
  const previousProvider = process.env.AI_PROVIDER;
  process.env.AI_PROVIDER = 'omnirouter';
  process.env.OMNIROUTER_API_KEY = 'omni-test-key';
  process.env.OMNIROUTER_GEMINI_BASE_URL = 'http://localhost:20128/v1beta';
  process.env.OMNIROUTER_MODEL = 'antigravity/gemini-3.7-flash-tiered';
  let request;
  globalThis.fetch = async (url, options) => {
    request = {url, options, body: JSON.parse(options.body)};
    return new Response(JSON.stringify({choices: [{message: {content: JSON.stringify({title: 'Story'})}}]}),
      {status: 200, headers: {'Content-Type': 'application/json'}});
  };
  try {
    assert.equal((await writeStory({}, {}, [])).title, 'Story');
    assert.equal(request.url, 'http://localhost:20128/v1/chat/completions');
    assert.equal(request.options.headers.Authorization, 'Bearer omni-test-key');
    assert.equal(request.body.model, 'antigravity/gemini-3.7-flash-tiered');
    assert.equal(request.body.response_format.json_schema.schema.type, 'object');
  } finally {
    globalThis.fetch = originalFetch;
    process.env.AI_PROVIDER = previousProvider;
  }
});

test('OmniRouter searches planned queries before accepting research', async () => {
  const originalFetch = globalThis.fetch;
  const previousProvider = process.env.AI_PROVIDER;
  process.env.AI_PROVIDER = 'omnirouter';
  process.env.OMNIROUTER_API_KEY = 'omni-test-key';
  process.env.OMNIROUTER_GEMINI_BASE_URL = 'http://localhost:20128/v1beta';
  process.env.OMNIROUTER_SEARCH_MODEL = 'antigravity/gemini-3.7-flash-tiered';
  const requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push({url, body: JSON.parse(options.body)});
    if (requests.length === 1) return new Response(JSON.stringify({choices: [{message: {
      content: JSON.stringify({queries: ['population ranking', 'country population 2026']}),
    }}]}), {status: 200});
    if (url.endsWith('/v1/search')) return new Response(JSON.stringify({results: [
      {title: 'Population', url: 'https://example.org/data', snippet: '2026 data'},
    ]}), {status: 200});
    return new Response(JSON.stringify({choices: [{message: {content: JSON.stringify({ideas})}}]}), {status: 200});
  };
  try {
    assert.equal((await brainstorm('population')).length, 3);
    assert.equal(requests[0].url, 'http://localhost:20128/v1/chat/completions');
    assert.equal(requests[0].body.response_format.json_schema.name, 'search_queries');
    assert.equal(requests[1].url, 'http://localhost:20128/v1/search');
    assert.equal(requests[1].body.query, 'population ranking');
    assert.equal(requests[2].body.query, 'country population 2026');
    assert.match(requests[3].body.messages[0].content, /https:\/\/example.org\/data/);
    assert.equal(requests[3].body.response_format.json_schema.name, 'ranking_ideas');
  } finally {
    globalThis.fetch = originalFetch;
    process.env.AI_PROVIDER = previousProvider;
  }
});

test('OmniRouter falls back to DuckDuckGo when its search provider returns no results', async () => {
  const originalFetch = globalThis.fetch;
  const previousProvider = process.env.AI_PROVIDER;
  process.env.AI_PROVIDER = 'omnirouter';
  let calls = 0;
  globalThis.fetch = async url => {
    if (url.startsWith('https://html.duckduckgo.com/')) return new Response(
      '<div class="result results_links results_links_deep web-result "><h2><a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.org%2Fdata&amp;rut=abc">Population <b>data</b></a></h2><a class="result__snippet">2026 population</a></div>',
      {status: 200});
    if (url.endsWith('/v1/search')) return new Response(JSON.stringify({results: []}), {status: 200});
    if (url.startsWith('https://www.bing.com/')) throw new Error('Bing should not be called');
    calls++;
    return new Response(JSON.stringify({choices: [{message: {content: JSON.stringify(calls === 1
      ? {queries: ['population ranking', 'country population']} : {ideas})}}]}), {status: 200});
  };
  try {
    assert.equal((await brainstorm('population')).length, 3);
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = originalFetch;
    process.env.AI_PROVIDER = previousProvider;
  }
});

test('OmniRouter falls back to Bing when the other searches return no results', async () => {
  const originalFetch = globalThis.fetch;
  const previousProvider = process.env.AI_PROVIDER;
  process.env.AI_PROVIDER = 'omnirouter';
  let calls = 0;
  globalThis.fetch = async url => {
    if (url.startsWith('https://html.duckduckgo.com/')) return new Response('', {status: 200});
    if (url.startsWith('https://www.bing.com/')) return new Response(
      '<li class="b_algo"><h2><a href="https://example.org/data">Population <strong>data</strong></a></h2><p class="b_lineclamp2">2026 population</p></li>',
      {status: 200});
    if (url.endsWith('/v1/search')) return new Response(JSON.stringify({results: []}), {status: 200});
    calls++;
    return new Response(JSON.stringify({choices: [{message: {content: JSON.stringify(calls === 1
      ? {queries: ['population ranking', 'country population']} : {ideas})}}]}), {status: 200});
  };
  try {
    assert.equal((await brainstorm('population')).length, 3);
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = originalFetch;
    process.env.AI_PROVIDER = previousProvider;
  }
});

test('OmniRouter rejects ranking when all web searches return empty results', async () => {
  const originalFetch = globalThis.fetch;
  const previousProvider = process.env.AI_PROVIDER;
  process.env.AI_PROVIDER = 'omnirouter';
  globalThis.fetch = async url => {
    if (url.startsWith('https://html.duckduckgo.com/')) return new Response('', {status: 200});
    if (url.startsWith('https://www.bing.com/')) return new Response('', {status: 200});
    if (url.endsWith('/v1/search')) return new Response(JSON.stringify({results: []}), {status: 200});
    return new Response(JSON.stringify({choices: [{message: {content: JSON.stringify({queries: ['population ranking', 'country population']})}}]}), {status: 200});
  };
  try {
    await assert.rejects(brainstorm('population'), /DuckDuckGo/);
  } finally {
    globalThis.fetch = originalFetch;
    process.env.AI_PROVIDER = previousProvider;
  }
});
