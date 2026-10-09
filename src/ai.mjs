import {requireEnv} from './common.mjs';
import {hasFiveQuotePoints} from './quote.mjs';

const object = (properties) => ({type: 'object', properties, required: Object.keys(properties), additionalProperties: false});
const str = {type: 'string'};
const num = {type: 'number'};
const array = (items) => ({type: 'array', items});
const boundedArray = (items, minItems, maxItems) => ({type: 'array', items, minItems, maxItems});

const ideaSchema = object({ideas: boundedArray(object({title: str, metric: str, latestPeriod: str,
  dataStatus: {type: 'string', enum: ['actual', 'estimate', 'forecast']},
  description: str, whyInteresting: str, suggestedSources: array(str), dataAvailability: num, viralPotential: num, surprisePotential: num}), 6, 8)});
const researchSchema = object({topicTitle: str, metricName: str, metricUnit: str, metricPeriod: str,
  items: array(object({entity: str, value: num, unit: str, period: str, sourceUrl: str, sourceTitle: str, evidence: str}))});
const footageQuerySchema = object({query: str, subject: str, anchors: boundedArray(str, 1, 3),
  visualAnchors: boundedArray(str, 2, 2)});
const storySchema = object({title: str, subtitle: str, hookText: str, caption: str,
  entityType: {type: 'string', enum: ['country', 'city', 'company', 'person', 'product', 'nature', 'sport', 'money', 'technology', 'generic']},
  hashtags: array(str), visualMood: str, musicMood: str, musicFile: str,
  backgroundQueries: boundedArray(footageQuerySchema, 16, 16)});
const quoteIdeaSchema = object({title: str, quoteText: str, hookText: str, captionText: str,
  hashtags: boundedArray(str, 3, 6)});
const quoteIdeasSchema = object({ideas: boundedArray(quoteIdeaSchema, 8, 8)});
const superTopicSchema = object({topic: str, reason: str});

const today = () => new Intl.DateTimeFormat('en-CA', {timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit'}).format(new Date());

export const aiConfig = () => {
  const provider = process.env.AI_PROVIDER || 'omnirouter';
  if (!['omnirouter', 'gemini'].includes(provider)) throw new Error(`AI_PROVIDER không hợp lệ: ${provider}`);
  const omnirouter = provider === 'omnirouter';
  return {
    provider,
    configured: omnirouter
      ? Boolean(process.env.OMNIROUTER_API_KEY && process.env.OMNIROUTER_GEMINI_BASE_URL)
      : Boolean(process.env.GEMINI_API_KEY),
    model: omnirouter
      ? process.env.OMNIROUTER_MODEL || 'antigravity/gemini-3.7-flash-tiered'
      : process.env.GEMINI_MODEL || 'gemini-3.8-flash',
    searchModel: omnirouter
      ? process.env.OMNIROUTER_SEARCH_MODEL || process.env.OMNIROUTER_MODEL || 'antigravity/gemini-3.7-flash-tiered'
      : process.env.GEMINI_SEARCH_MODEL || process.env.GEMINI_MODEL || 'gemini-3.8-flash',
    quoteModel: omnirouter
      ? process.env.OMNIROUTER_QUOTE_MODEL || 'antigravity/gemini-3.7-flash-tiered'
      : process.env.GEMINI_QUOTE_MODEL || 'gemini-3.1-flash-lite',
  };
};

function geminiSchema(value) {
  if (Array.isArray(value)) return value.map(geminiSchema);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value)
      .filter(([key]) => key !== 'additionalProperties')
      .map(([key, item]) => [key, geminiSchema(item)]));
  }
  return value;
}

function parseJson(content) {
  const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```|(\{[\s\S]*\}|\[[\s\S]*\])/);
  return JSON.parse(jsonMatch ? (jsonMatch[1] || jsonMatch[2]) : content);
}

function plainHtml(value) {
  return value.replace(/<[^>]*>/g, '').replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&(?:amp|quot|apos|lt|gt|nbsp);/g, entity => ({
      '&amp;': '&', '&quot;': '"', '&apos;': "'", '&lt;': '<', '&gt;': '>', '&nbsp;': ' ',
    })[entity]).trim();
}

function bingResultUrl(href) {
  const url = new URL(plainHtml(href));
  if (url.hostname === 'www.bing.com' && url.pathname.startsWith('/ck/')) {
    const encoded = url.searchParams.get('u');
    if (!encoded?.startsWith('a1')) return null;
    const target = new URL(Buffer.from(encoded.slice(2), 'base64url').toString('utf8'));
    return target.protocol === 'https:' || target.protocol === 'http:' ? target.href : null;
  }
  return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
}

async function searchBing(query) {
  const response = await fetch(`https://www.bing.com/search?q=${encodeURIComponent(query)}&count=10`, {
    headers: {'User-Agent': 'Mozilla/5.0', 'Accept-Language': 'en-US,en;q=0.9'},
  });
  if (!response.ok) return [];
  const html = await response.text();
  const results = [];
  for (const block of html.split(/<li class="b_algo"[^>]*>/i).slice(1)) {
    const link = block.match(/<h2[^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
    if (!link) continue;
    let url;
    try { url = bingResultUrl(link[1]); } catch { continue; }
    if (!url) continue;
    const snippet = block.match(/<p[^>]*class="[^"]*b_lineclamp[^"]*"[^>]*>([\s\S]*?)<\/p>/i);
    results.push({title: plainHtml(link[2]), url, snippet: plainHtml(snippet?.[1] || '').slice(0, 300)});
    if (results.length === 5) break;
  }
  return results;
}

async function searchDuckDuckGo(query) {
  const response = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
    headers: {'User-Agent': 'Mozilla/5.0', 'Accept-Language': 'en-US,en;q=0.9'},
  });
  if (!response.ok) return [];
  const html = await response.text();
  const results = [];
  for (const block of html.split(/<div class="result results_links[^\"]*"[^>]*>/i).slice(1)) {
    const link = block.match(/<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
    if (!link) continue;
    let url;
    try {
      const href = new URL(plainHtml(link[1]), 'https://duckduckgo.com');
      url = href.hostname === 'duckduckgo.com' && href.pathname === '/l/'
        ? new URL(href.searchParams.get('uddg')) : href;
    } catch { continue; }
    if (!['https:', 'http:'].includes(url.protocol) || url.hostname.endsWith('duckduckgo.com')) continue;
    const snippet = block.match(/<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/i);
    results.push({title: plainHtml(link[2]), url: url.href,
      snippet: plainHtml(snippet?.[1] || '').slice(0, 300)});
    if (results.length === 5) break;
  }
  return results;
}

async function generateOmni(name, schema, input, web, model) {
  let baseUrl = requireEnv('OMNIROUTER_GEMINI_BASE_URL').replace(/\/+$/, '').replace(/\/v1beta$/, '');
  if (process.env.RUNNING_IN_DOCKER === '1') {
    baseUrl = baseUrl.replace(/:\/\/(?:localhost|127\.0\.0\.1)(?=[:/]|$)/, '://host.docker.internal');
  }
  const headers = {'Content-Type': 'application/json', Authorization: `Bearer ${requireEnv('OMNIROUTER_API_KEY')}`};
  const post = async (path, body) => {
    const response = await fetch(`${baseUrl}${path}`, {method: 'POST', headers, body: JSON.stringify(body)});
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`OmniRouter ${name}: ${data.error?.message || `HTTP ${response.status}`}`);
    return data;
  };
  let evidence = [];
  let searches = 0;
  let fallbackSearches = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  if (web) {
    const querySchema = object({queries: boundedArray(str, 2, 4)});
    const plan = await post('/v1/chat/completions', {model, stream: false,
      messages: [{role: 'user', content: `Viết 3 truy vấn web ngắn, khác nhau, ưu tiên nguồn dữ liệu chính thức để trả lời yêu cầu sau. Chỉ trả JSON.\n${input}`}],
      response_format: {type: 'json_schema', json_schema: {name: 'search_queries', strict: true, schema: querySchema}},
    });
    inputTokens += plan.usage?.prompt_tokens || 0;
    outputTokens += plan.usage?.completion_tokens || 0;
    const queries = parseJson(plan.choices?.[0]?.message?.content || '{}').queries;
    if (!Array.isArray(queries) || !queries.length) throw new Error(`OmniRouter không tạo truy vấn tìm kiếm cho ${name}.`);
    evidence = await Promise.all(queries.slice(0, 4).filter(query => typeof query === 'string' && query.trim())
      .map(async query => {
        searches++;
        let results = [];
        try {
          const found = await post('/v1/search', {query: query.trim(), max_results: 5});
          results = (found.results || []).slice(0, 5).map(item => ({
            title: item.title, url: item.url, snippet: String(item.snippet || '').slice(0, 300),
          }));
        } catch (error) {
          console.warn(`OmniRouter search failed for ${name}: ${error.message}`);
        }
        if (!results.length) {
          for (const search of [searchDuckDuckGo, searchBing]) {
            try { results = await search(query.trim()); } catch (error) {
              console.warn(`${search.name} failed for ${name}: ${error.message}`);
            }
            if (results.length) { fallbackSearches++; break; }
          }
        }
        return {query, results};
      }));
    if (!evidence.some(item => item.results.length)) throw new Error(`Không tìm được nguồn web qua OmniRoute, DuckDuckGo hoặc Bing cho ${name}.`);
  }
  const data = await post('/v1/chat/completions', {
    model, stream: false,
    messages: [{role: 'user', content: `${input}\n\n${web ? `Kết quả tìm kiếm web vừa thực hiện (chỉ dùng URL có trong đây làm nguồn): ${JSON.stringify(evidence)}\n\n` : ''}Trả lời bằng JSON hợp lệ, không có gì khác ngoài JSON.`}],
    ...(schema ? {response_format: {type: 'json_schema', json_schema: {name, strict: true, schema}}} : {}),
    ...(name.startsWith('quote_') ? {max_tokens: name === 'quote_ideas' ? 12000 : 4500} : {}),
  });
  inputTokens += data.usage?.prompt_tokens || 0;
  outputTokens += data.usage?.completion_tokens || 0;
  const content = data.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content) throw new Error(`OmniRouter không trả nội dung cho ${name}.`);
  console.log(`OmniRouter ${name}: ${model}, ${inputTokens} input + ${outputTokens} output tokens, ${searches} web searches${fallbackSearches ? ` (${fallbackSearches} search fallback)` : ''}`);
  return parseJson(content);
}

async function generate(name, schema, input, web = false) {
  const config = aiConfig();
  const useSchema = !web && schema;
  const model = web ? config.searchModel : name.startsWith('quote_') ? config.quoteModel : config.model;
  const omnirouter = config.provider === 'omnirouter';
  if (omnirouter) return generateOmni(name, schema, input, web, model);
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const headers = {'Content-Type': 'application/json', 'x-goog-api-key': requireEnv('GEMINI_API_KEY')};

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      contents: [{role: 'user', parts: [{text: useSchema ? input : `${input}\n\nTrả lời bằng JSON hợp lệ, không có gì khác ngoài JSON.`}]}],
      ...(web ? {tools: [{google_search: {}}]} : {}),
      generationConfig: {
        responseMimeType: 'application/json',
        ...(name.startsWith('quote_') ? {maxOutputTokens: name === 'quote_ideas' ? 12000 : 4500} : {}),
        ...(useSchema ? {responseSchema: geminiSchema(schema)} : {}),
      },
    }),
  });
  const data = await response.json().catch(() => ({}));
  const via = 'Gemini AI Studio';
  if (!response.ok) {
    const detail = data.error?.details?.[0]?.fieldViolations?.join('; ') ||
      data.error?.details?.[0]?.reason || '';
    throw new Error(`${via} ${name}: ${data.error?.message || `HTTP ${response.status}`}${detail ? ` (${detail.slice(0, 400)})` : ''}`);
  }
  const content = data.candidates?.[0]?.content?.parts?.filter(part => typeof part.text === 'string').map(part => part.text).join('') || '';
  if (!content) throw new Error(`${via} không trả nội dung cho ${name}.`);
  const searches = data.candidates?.[0]?.groundingMetadata?.webSearchQueries?.length || 0;
  if (web && !searches) throw new Error(`${via} không thực hiện Google Search cho ${name}.`);
  if (data.usageMetadata) console.log(`${via} ${name}: ${model}, ${data.usageMetadata.promptTokenCount || 0} input + ${data.usageMetadata.candidatesTokenCount || 0} output tokens, ${searches} web searches`);

  return parseJson(content);
}

export async function brainstorm(prompt) {
  const result = await generate('ranking_ideas', ideaSchema,
    `Hôm nay là ${today()} tại Việt Nam. Bạn là biên tập viên video ranking ngắn cho khán giả phổ thông. Chủ đề gốc: ${prompt}\n` +
    `Dùng web search NGAY BÂY GIỜ để kiểm tra nguồn và kỳ dữ liệu mới nhất có thể dùng; đừng mặc định năm 2024 hoặc dùng trí nhớ làm nguồn. ` +
    `Đề xuất 6-8 góc xếp hạng liên quan chủ đề gốc, dễ hiểu trong 3 giây. Tối đa 2 ý tưởng thuộc cùng một họ chỉ số (ví dụ không làm 8 biến thể GDP). ` +
    `Title là câu ngắn, cuốn hút, tự nhiên như tiêu đề video TikTok, tối đa 55 ký tự; phải nói rõ đang xếp hạng cái gì. Không viết title dạng câu hỏi có/không, ẩn dụ khó hiểu, không nhét năm, thuật ngữ hoặc cách tính dài vào title. ` +
    `whyInteresting là hook một câu, tối đa 90 ký tự: nêu một kết quả bất ngờ, khoảng cách đáng chú ý hoặc điều người xem dễ đoán sai dựa trên nguồn vừa tìm. Không hứa hẹn mơ hồ, không giật tít sai. description một câu đơn giản. ` +
    `metric vẫn phải xác định chính xác một đại lượng đo được, có ít nhất 10 giá trị cùng kỳ và đơn vị; phần kỹ thuật nằm ở metric, không nằm ở title. ` +
    `latestPeriod chỉ ghi một năm/kỳ cụ thể; dataStatus chọn đúng một trong actual (số đã công bố), estimate (ước tính), forecast (dự báo). Không ghi trạng thái mơ hồ như "thực tế/ước tính". suggestedSources chứa 1-2 URL trực tiếp vừa tìm thấy, không tự tạo URL. ` +
    `Ưu tiên dữ liệu thực tế mới nhất; không đề xuất kỳ cũ khi đã có kỳ mới hơn. Nếu chỉ tìm thấy dữ liệu cũ, bỏ góc đó. ` +
    `Tránh PPP, chia theo lao động, nợ công, giá trị gia tăng ngành, tăng trưởng ghép nhiều năm, hoặc jargon tương tự trừ khi người dùng yêu cầu rõ. ` +
    `Đánh giá ba score từ 0 đến 1 và sắp ý tưởng hay, dễ làm trước.`, true);
  if (!Array.isArray(result.ideas) || result.ideas.length < 3) throw new Error(`Không tạo đủ ý tưởng (${result.ideas?.length || 0}; keys: ${Object.keys(result).join(', ')}).`);
  const explicitYear = /(?:19|20)\d{2}/.test(prompt);
  const minYear = Number(today().slice(0, 4)) - 1;
  const ideas = result.ideas.filter(idea => {
    const years = [...idea.latestPeriod.matchAll(/(?:19|20)\d{2}/g)].map(match => Number(match[0]));
    return explicitYear || (years.length > 0 && Math.max(...years) >= minYear);
  }).slice(0, 8);
  if (ideas.length < 3) throw new Error(`Chỉ có ${ideas.length} ý tưởng với dữ liệu từ ${minYear} trở đi. Hãy thử chủ đề khác hoặc nêu rõ năm mong muốn.`);
  return ideas;
}

export async function discoverSuperTopic({template, focus = '', recent = []}) {
  const quote = template === 'quote';
  const result = await generate(quote ? 'quote_super_topic' : 'ranking_super_topic', superTopicSchema,
    quote
      ? `Bạn là biên tập viên video Quote tiếng Việt. Tự chọn MỘT chủ đề mới, cụ thể để viết nội dung nguyên bản. ` +
        `Định hướng của kênh: ${focus || 'quyền quyết định, lãnh đạo, chọn người, cắt lỗ, lợi ích, kỷ luật và cái giá của sự yếu tay'}. ` +
        `Tránh trùng các chủ đề đã làm: ${JSON.stringify(recent)}. Chủ đề phải viết thành một câu ngắn, đủ rõ để tạo 8 góc nội dung khác nhau. ` +
        `Ưu tiên tình thế có xung đột lợi ích, quyết định khó hoặc hậu quả rõ; tránh chủ đề quá hiền như lời nhắc sống tốt, giao tiếp tích cực hay truyền cảm hứng chung chung. ` +
        `Không nêu tên người nổi tiếng, trích dẫn hay lời khuyên sáo rỗng. reason giải thích một câu vì sao chủ đề hợp kênh.`
      : `Hôm nay là ${today()} tại Việt Nam. Bạn là biên tập viên video xếp hạng. Dùng web search NGAY BÂY GIỜ ` +
        `để tự tìm MỘT chủ đề ranking mới, có nguồn số liệu chính thức gần đây, tối thiểu 10 đối tượng cùng kỳ. ` +
        `Định hướng của kênh: ${focus || 'các dữ liệu đời sống, kinh tế, công nghệ, du lịch và thế giới dễ hiểu'}. ` +
        `Tránh trùng các chủ đề đã làm: ${JSON.stringify(recent)}. Chủ đề phải ngắn, cụ thể, dễ hiểu, khả thi để kiểm chứng và làm video 30 giây. ` +
        `reason giải thích ngắn nguồn dữ liệu và kỳ mới nhất đã thấy. Không tự tạo URL.`, !quote);
  const topic = String(result.topic || '').trim();
  if (topic.length < 3 || topic.length > 150 || recent.some(value => value.toLowerCase() === topic.toLowerCase())) {
    throw new Error('AI chưa tìm được chủ đề mới phù hợp. Sẽ thử lại ở chu kỳ sau.');
  }
  return topic;
}

function quoteIdeaIssue(idea) {
  if (!idea || typeof idea !== 'object') return 'thiếu nội dung';
  if (String(idea.quoteText || '').trim()) return 'quoteText phải để trống';
  const hook = String(idea.hookText || '').trim();
  const hookLength = hook.length;
  if (hookLength < 85 || hookLength > 160) return `hook dài ${hookLength} ký tự, cần 85-160`;
  if (/[?？]/u.test(hook)) return 'hook không được đặt câu hỏi';
  if (/(^|[^\p{L}])(bạn|tôi|mình|chúng ta|chúng tôi|anh|em|cậu|tớ|mày|quý vị)(?=$|[^\p{L}])/iu.test(hook)) {
    return 'hook không được dùng đại từ xưng hô';
  }
  if (!/^(?:đừng|không|cắt|dẹp|loại|chặn|bỏ|giữ|nghe|lắng nghe|nhìn|lật|chọn|nắm|tách|vạch|đập|bóc|siết|dừng|đọc|xé|đóng|mở|chốt|5 điều phải biết)(?=$|[^\p{L}\p{N}])/iu.test(hook)) {
    return 'hook phải mở bằng Đừng, Không, động từ mạnh hoặc “5 điều phải biết”';
  }
  if (/%|phần trăm/iu.test(hook)) return 'hook không được dùng tỷ lệ chưa kiểm chứng';
  const captionLength = String(idea.captionText || '').trim().length;
  if (captionLength < 450 || captionLength > 1800) return `caption dài ${captionLength} ký tự, cần 450-1800`;
  if (!hasFiveQuotePoints(idea.captionText)) return 'caption cần đúng 5 ý đánh số từ 1 đến 5';
  return null;
}

async function repairQuoteIdea(prompt, idea, index) {
  let issue = quoteIdeaIssue(idea);
  for (let attempt = 0; attempt < 2 && issue; attempt++) {
    const repaired = await generate('quote_idea_repair', quoteIdeaSchema,
      `Sửa MỘT nội dung Quote tiếng Việt cho chủ đề: ${prompt}. Đây là phương án số ${index + 1} trong nhóm 8 phương án, giữ nguyên góc nhìn riêng của nó. ` +
      `Bản cần sửa: ${JSON.stringify(idea)}. Lỗi cần khắc phục: ${issue}. ` +
      `Trả đúng một object với title, quoteText, hookText, captionText, hashtags. quoteText là chuỗi rỗng; hookText mục tiêu 95-140 ký tự, gọn và đọc trong khoảng 5 giây trên ảnh. Mở NGAY bằng “Đừng”, “Không”, một động từ mạnh như “Cắt”, “Dẹp”, “Loại”, “Lắng nghe”, hoặc “5 điều phải biết”; sau đó đâm thẳng vào động cơ tâm lý và cái giá. Không mở bằng danh từ trừu tượng như “Thói quen”, “Sự”, “Việc”. Không đặt câu hỏi, không dùng “Hãy”, “Nên”, “Cần”, không xưng hô “bạn”, “tôi”, “mình”, “anh”, “em”, không bịa tỷ lệ hoặc số liệu. ` +
      `captionText 550-1500 ký tự, gồm đúng 5 đoạn đánh số 1. đến 5., không có mở bài hoặc kết bài ngoài 5 đoạn. Mỗi ý mới, cụ thể, trực diện và có tình huống hoặc hệ quả; nội dung chính nằm ở caption. ` +
      `Giọng lạnh, sắc, thực dụng như người đứng đầu phải chốt việc và chịu hậu quả. Ưu tiên luật chơi, quyền quyết định, chọn người, cắt lỗ và lợi ích nếu hợp chủ đề. ` +
      `Mỗi mục mở bằng một câu ngắn có lực, câu sau chỉ ra ai trả giá khi quyết định bị trì hoãn hoặc nguyên tắc bị phá. Dùng lời nói thường ngày, tránh văn bản đào tạo quản lý. Tránh văn danh ngôn, chữa lành, lời khuyên hiền và đạo đức sách giáo khoa. Không chửi bới, kể trải nghiệm cá nhân, bịa tỷ lệ hay gợi ý phạt tiền/hạ lương nhân viên tùy tiện.`, false);
    issue = quoteIdeaIssue(repaired);
    if (!issue) return repaired;
    idea = repaired;
  }
  throw new Error(`AI chưa sửa được nội dung Quote số ${index + 1}: ${issue}. Hãy thử tạo lại.`);
}

export async function brainstormQuotes(prompt, mode) {
  if (mode !== 'caption') throw new Error('Chế độ Quote không hợp lệ.');
  const result = await generate('quote_ideas', quoteIdeasSchema,
    `Bạn là biên tập viên video ngắn tiếng Việt. Hãy viết đúng 8 nội dung nguyên bản từ chủ đề: ${prompt}. ` +
    `Định hướng biên tập: triết lý sắc, lạnh và thực dụng về quyền quyết định, lãnh đạo, chọn người, đặt luật, cắt lỗ, lợi ích, tiền bạc, trách nhiệm và cái giá của sự yếu tay. Viết cho người phải đứng đầu một đội, một cuộc làm ăn hoặc chính cuộc đời mình; dám chịu phần quyết định khó. ` +
    `Bám sát chủ đề người dùng nhập. Nếu chủ đề rộng, trải 8 idea qua nhiều góc khác nhau; nếu chủ đề hẹp, đào sâu 8 hành vi, tình huống hoặc hệ quả thực sự khác nhau. Không tự gán cho chủ đề những chi tiết không được nêu: ví dụ “trách người khác không giúp” không mặc nhiên là vay nợ, đầu tư thua lỗ hay lười biếng. Trong 8 idea không lặp cùng luận điểm “không ai có nghĩa vụ giúp bạn” hoặc cùng bối cảnh. ` +
    `Giọng của người có quyền chốt việc và chấp nhận mất lòng: tỉnh, gọn, sắc, đôi khi tàn nhẫn với ảo tưởng. Câu chữ phải có thế đối đầu, lợi ích, trách nhiệm hoặc hậu quả cụ thể. Nói thẳng một quy tắc khó nghe, rồi chứng minh bằng cơ chế đời thực; không giảng đạo, không dỗ dành. Lãnh đạo không phải hình ảnh oai phong chung chung mà là quyết định ai được quyền làm gì, ai chịu giá của sai lầm và khi nào phải dừng. ` +
    `Tránh giọng chữa lành, nhân văn sáo, văn sách giáo khoa, vỗ về, than thân, lụy tình và khẩu hiệu truyền động lực. Không viết lời khuyên hiền ai cũng gật đầu như “hãy giao tiếp rõ ràng”, “hãy tôn trọng mọi người”, “hãy tin vào bản thân” nếu không có luật chơi và cái giá cụ thể. Không lặp các mô-típ “cứ đi tiếp”, “buông bỏ”, “im lặng rồi rời đi”, “để kết quả lên tiếng”. ` +
    `Mỗi idea có hookText mục tiêu 95-140 ký tự để đọc trong khoảng 5 giây trên ảnh. CÂU ĐẦU PHẢI ĐẬP VÀO MẮT: mở ngay bằng “Đừng…”, “Không…”, một động từ mạnh như “Cắt…”, “Dẹp…”, “Loại…”, “Lắng nghe…”, hoặc “5 điều phải biết…”. Trong 8 hook, dùng đủ các kiểu mở này và đổi cấu trúc câu; không để cả nhóm thành một mẫu lặp. Chốt một sự thật khó nghe về tâm lý quyền lực: sợ mất lòng, nghiện lời thuận tai, tham quyền, trốn trách nhiệm, ham giữ thể diện, hoặc tự lừa mình; gắn nó với kẻ hưởng lợi và cái giá cụ thể. Viết ngắn, thẳng, hơi tàn nhẫn; bỏ cụm đệm như “thực chất là”, “có thể”, “một trong những”, “điều quan trọng là”. Nói cụ thể ai lọc thông tin, ai ký quyết định sai, ai hưởng lợi, ai mất tiền hoặc mất người giỏi. Không dùng ẩn dụ kịch tính như “con rối”, “cái bẫy”, “sân khấu”, “đống đổ nát”, “rút tiền từ túi”; không dùng lời mạnh để che một ý rỗng. Không mở bằng danh từ trừu tượng như “Thói quen”, “Sự”, “Việc”, “Một”; không viết khẩu hiệu rỗng, checklist hiền hay câu dạy đời. Ví dụ về nhịp, không chép lại: “Đừng nghe một phía rồi phán. Kẻ xu nịnh thắng từ lúc lời nịnh được coi là sự thật.” Không đặt câu hỏi; không dùng “Hãy”, “Nên”, “Cần”; không xưng hô “bạn”, “tôi”, “mình”, “chúng ta”, “anh”, “em” trong hookText. Hook chỉ ném cú đấm đầu, phần mổ xẻ nằm trong caption. Không tự bịa phần trăm, thống kê hoặc kết quả định lượng để gây sốc. ` +
    `captionText mục tiêu 750-1300 ký tự và gồm ĐÚNG 5 mục đánh số 1. đến 5., mỗi mục một đoạn riêng, cách nhau một dòng trống; không có lời dẫn trước mục 1 hay đoạn kết ngoài mục 5. Mỗi mục mở bằng một câu ngắn có lực như một quy tắc khó nghe; câu sau lột rõ động cơ tâm lý, ai lợi dụng nó, hành động và cái giá phải trả. Dùng động từ cụ thể như chọn, thay, dừng, giao quyền, ghi rõ, từ chối, cắt lỗ khi đúng ngữ cảnh. Mục 1 tiếp nối hookText; các mục sau nâng mức cược hoặc lật thêm một mặt của vấn đề; mục 5 chốt bằng một quyết định rõ. Nội dung chính nằm trong caption; không chép lại hook và không mời đọc caption. quoteText để chuỗi rỗng. ` +
    `Học nhịp viết từ ba kiểu bài người dùng thích: danh sách quy tắc ngắn và rắn; chuỗi nhận định bóc tách thói quen đổ lỗi và trách nhiệm; hoặc năm cặp ưu tiên kiểu “Cắt lỗ > Kiên trì”, “Nguyên tắc > Thể diện”, sau đó giải thích cái giá của lựa chọn. Một câu mẫu về chất giọng: “Giữ người sai việc vì sợ mang tiếng tàn nhẫn là bắt cả đội trả lương cho sự yếu tay của sếp.” Dùng cách tư duy và nhịp câu đó, tuyệt đối không chép lại. Chọn một kiểu hợp chủ đề cho từng idea và đổi cách triển khai giữa 8 idea. Mỗi mục phải thêm một góc mới, không diễn đạt lại cùng một lời khuyên năm lần. ` +
    `Chất đến từ cái giá thật, không đến từ chửi bới, đe dọa hay ẩn dụ kịch tính như “phao cứu sinh”, “đáy xã hội”, “chiếc khiên”, “bão tố”, “hố không đáy”, “kỷ luật thép”. Không hạ nhục người nghèo, người gặp khó khăn hoặc gán nhãn cả một giới; phê thẳng hành vi và quyết định sai. ` +
    `Đừng viết như slide đào tạo quản lý hoặc văn bản công ty: hạn chế “trách nhiệm cốt lõi”, “phân bổ chỉ tiêu”, “đãi ngộ tương xứng”, “hiệu suất chung của tổ chức”, “đàm phán xử lý vi phạm”, “mang tính hình thức”. Nói bằng từ người làm ăn dùng thật: giữ người sai, người giỏi gánh việc, tiền đội lên, mất quyền chọn, ghi sổ, chốt, dừng. Tránh mở cả 5 mục bằng “hãy”, “cần”, “luôn” hoặc biến 5 ý thành checklist nghiệp vụ. ` +
    `Không bịa trải nghiệm cá nhân, giao dịch, số tiền, tỷ lệ, mốc thời gian hoặc kết quả kinh doanh như chuyện có thật; nếu cần minh họa, dùng tình huống giả định và không xưng “tôi từng”. Không tự đặt số kiểu “gấp ba lần chi phí”, không gọi cắt lỗ là sinh lời, không hứa rằng giữ một quy tắc sẽ chắc chắn kiếm được tiền. Không gợi ý phạt tiền hay hạ lương nhân viên tùy tiện; nói về tiêu chuẩn công việc, phân quyền, điều chuyển hoặc thay người theo thỏa thuận phù hợp. ` +
    `Không trích dẫn, không gắn tên tác giả hay người nổi tiếng, không bắt chước câu nói nổi tiếng. ` +
    `Mỗi idea phải có một góc nhìn riêng, câu chữ tự nhiên, sắc, cụ thể, không sáo rỗng và không dùng dấu ngoặc kép bao quanh toàn bộ nội dung. Tránh mở đầu giống nhau ở 8 idea; không dùng mồi câu kiểu “ít ai biết”, “sự thật là”, “xem đến cuối”. Không ép người xem bình luận hoặc chia sẻ. ` +
    `title dài tối đa 55 ký tự, nêu rõ ý chính bằng từ người xem thường tìm kiếm và dùng làm tên video; tránh tiêu đề kiểu “Tầm quan trọng của”, “Bài học về”, “Kỹ năng”. Hashtag gồm 3-5 từ liên quan trực tiếp đến nội dung, không có dấu #; không dùng fyp, viral, xuhuong hoặc tag chung chung. ` +
    `Chỉ trả title, quoteText, hookText, captionText và hashtags cho từng idea. Không lập kế hoạch footage trong lượt này.`, false);
  if (!Array.isArray(result.ideas) || result.ideas.length !== 8) {
    throw new Error(`AI chỉ tạo ${result.ideas?.length || 0}/8 nội dung Quote. Hãy thử lại.`);
  }
  for (const [index, idea] of result.ideas.entries()) {
    const issue = quoteIdeaIssue(idea);
    if (!issue) continue;
    console.warn(`Đang sửa nội dung Quote số ${index + 1}: ${issue}.`);
    result.ideas[index] = await repairQuoteIdea(prompt, idea, index);
  }
  return result.ideas;
}

export async function research(idea) {
  const prompt =
    `Hôm nay là ${today()} tại Việt Nam. Hãy dùng web search thực sự để nghiên cứu bảng xếp hạng này: ${JSON.stringify(idea)}. ` +
    `Tìm kỳ dữ liệu MỚI NHẤT hiện đã công bố cho cùng một metric; đối chiếu với latestPeriod trong ý tưởng và tìm lại nếu có kỳ mới hơn. ` +
    `Ưu tiên số thực tế; chỉ dùng ước tính/dự báo nếu đó là dữ liệu mới nhất phù hợp. metricPeriod phải NGẮN và chỉ chứa một kỳ, ví dụ "2025 (thực tế)" hoặc "2026 (dự báo)"; không kèm diễn giải hoặc nhắc năm cũ. ` +
    `BẮT BUỘC trả 10-15 dòng cùng kỳ và cùng đơn vị. item.period phải giống hệt metricPeriod và item.unit phải giống hệt metricUnit. Dùng tên quốc gia tiếng Việt phổ thông cho entity. Mỗi value phải lấy từ trang nguồn được mở/tra cứu, có URL trực tiếp, title và evidence ngắn. ` +
    `Ưu tiên một bảng chính thức duy nhất có đủ nhiều dòng. Nếu trang nguồn là bảng động, hãy tìm file tải xuống hoặc API công khai chính thức của cùng đơn vị phát hành; URL API trực tiếp được chấp nhận. Nếu kỳ mong muốn chưa đủ 10 dòng, tự dùng kỳ chung mới nhất có ít nhất 10 dòng và ghi đúng kỳ/trạng thái đó, không trả mảng rỗng chỉ vì phải lùi một kỳ. ` +
    `Không ước đoán, không tự tạo URL, không trộn GDP nominal với PPP, không trộn năm, không dùng số 2024 nếu đã có 2025/2026 tương ứng. ` +
    `Giá trị number phải là số thô theo metricUnit (vd tỷ USD thì 5.2, không phải 5.2e9).`;
  const first = await generate('ranking_research', researchSchema, prompt, true);
  if (Array.isArray(first.items) && first.items.length >= 10) return first;
  console.warn(`Research lần đầu chỉ có ${first.items?.length || 0} dòng; đang tự thử lại.`);
  return generate('ranking_research_retry', researchSchema,
    `${prompt} Lần tìm trước chỉ thu được ${first.items?.length || 0} dòng. Hãy cố gắng trả đủ ít nhất 10 dòng với dữ liệu thực tế.`,
    true);
}

export async function writeStory(facts, idea, musicFiles = []) {
  return generate('ranking_story', storySchema,
    `Viết text nhanh, rõ bằng tiếng Việt cho video dọc 30 giây có toàn bộ bảng xếp hạng hiện xuyên suốt trên footage động. Góc nội dung đã chọn: ${JSON.stringify({title: idea.title, hook: idea.whyInteresting})}. Dữ liệu đã kiểm tra: ${JSON.stringify(facts)}. ` +
    `Không sửa số liệu/thứ hạng/entity. Title <= 55 ký tự, bám sát góc đã chọn, gọi tên đối tượng và chủ đề bằng từ khán giả thường tìm; trong vài từ đầu phải cho biết video xếp hạng gì. Không dùng jargon, cách tính dài, dấu ba chấm hay giật tít lệch dữ liệu. ` +
    `Subtitle <= 70 ký tự, ghi metric và kỳ dữ liệu bằng ngôn ngữ đơn giản; nếu dữ liệu là dự báo hoặc ước tính phải nói rõ. ` +
    `hookText <= 90 ký tự sẽ là CÂU ĐẦU CỦA CAPTION, không che bảng trên video: chọn một kết quả hoặc khoảng cách đáng chú ý từ top 10 ĐÃ KIỂM TRA, nói thẳng dữ kiện nhưng vẫn tạo lý do xem phần còn lại. Không dùng thông tin ngoài bảng, không hỏi mơ hồ, không lặp title. ` +
    `Caption 100-220 ký tự, viết tiếp sau hookText bằng bối cảnh hoặc một đối chiếu khác có trong top 10; không chép lại hoặc diễn đạt lại cùng ý của hookText. Nêu đúng kỳ dữ liệu; nếu là dự báo hoặc ước tính phải ghi rõ. Có thể kết bằng một câu hỏi tự nhiên gắn với dữ liệu, nhưng không ép tương tác. Không lặp nguyên title, không nói “xem đến cuối”, không chèn URL, tên nguồn hoặc danh sách nguồn. ` +
    `entityType mô tả loại thực thể đang xếp hạng để chọn icon. Chọn country cho quốc gia, city cho thành phố, company cho doanh nghiệp, person cho con người, product cho sản phẩm, nature cho địa danh/tự nhiên, sport cho thể thao, money cho tiền tệ/tài chính, technology cho công nghệ; nếu không khớp thì generic. ` +
    `Các file nhạc nền local HIỆN ĐANG TỒN TẠI: ${JSON.stringify(musicFiles)}. musicFile phải khớp chính xác một tên trong danh sách hiện tại; tuyệt đối không nhắc lại file cũ/đã xóa. Nếu danh sách rỗng thì để chuỗi rỗng. Chọn theo musicMood và sắc thái gợi từ tên file; không khẳng định đã nghe file. ` +
    `backgroundQueries phải có ĐÚNG 16 phần tử để dựng cảnh cắt nhanh. Mỗi phần tử gồm query tiếng Anh, subject ngắn, 1-3 anchors và đúng 2 visualAnchors. Mười phần tử đầu phải ứng với TỪNG entity trong top 10, dùng tên tiếng Anh đúng và một cảnh đặc trưng liên quan trực tiếp đến metric. Sáu phần tử cuối là sáu cảnh hoạt động khác nhau của chính metric/chủ đề, dễ tìm trên stock video. ` +
    `Mỗi query chỉ dài 3-6 từ khóa, đặt tên quốc gia/thành phố/đối tượng đặc trưng lên đầu để Pixabay tìm đúng; ví dụ "Germany Frankfurt skyline aerial", không viết thành câu mô tả dài. anchors là các tên riêng hoặc chủ thể bắt buộc phải xuất hiện trong metadata kết quả, ví dụ ["germany", "frankfurt"] hoặc ["factory"]. visualAnchors gồm đúng 2 TỪ ĐƠN tiếng Anh thường có trong tag video. Phần tử đầu là VẬT/CẢNH phải nhìn thấy như "skyline", "traffic", "factory", "container"; phần tử thứ hai là chuyển động/góc máy như "aerial", "timelapse", "production", "cranes". Hai từ phải mô tả cùng một cảnh khả thi; không ghép hai bối cảnh khác nhau như skyline với factory, port với production line hoặc train với traffic. ` +
    `Ưu tiên hình có chuyển động mạnh như aerial, drone, timelapse, night traffic, production line hoặc close up. Không dùng cụm chung chung như "global economy", "business background" hay "world map". Tránh watermark, chữ, logo, infographic, hoạt hình, video AI và talking head. ` +
    `Chọn 3-5 hashtag sát thực thể/chỉ số, không có dấu #; không dùng fyp, viral, xuhuong hoặc tag không liên quan. Không nói "mới nhất" nếu kỳ dữ liệu cũ.`);
}
