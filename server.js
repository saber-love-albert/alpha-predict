import express from 'express';
import cors from 'cors';
import 'dotenv/config';
import yahooFinance from 'yahoo-finance2';
import { GoogleGenAI } from '@google/genai';

const app = express();

app.use(cors({
  origin: '*',
  methods: ['GET', 'POST']
}));

app.use(express.json());

if (!process.env.GEMINI_API_KEY) {
  console.error('錯誤：未在 .env 中偵測到 GEMINI_API_KEY。請先設定您的 API 金鑰。');
}

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

app.get('/api/predict/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;
    
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(endDate.getDate() - 60);

    const queryOptions = {
      period1: startDate.toISOString().split('T')[0],
      period2: endDate.toISOString().split('T')[0],
      interval: '1d'
    };

    console.log(`[系統] 正在抓取 ${symbol} 的歷史數據...\n`);

    let historicalData;
    try {
      historicalData = await yahooFinance.historical(symbol, queryOptions);
    } catch (err) {
      console.error(`[錯誤] 無法取得 ${symbol} 的 Yahoo Finance 數據:`, err.message);
      return res.status(404).json({ 
        success: false, 
        error: `找不到標的 "${symbol}" 的歷史資料。台股請加 .TW（例如 2330.TW），美股請用大寫（例如 AAPL）。` 
      });
    }
    
    if (!historicalData || historicalData.length === 0) {
      return res.status(404).json({ success: false, error: '抓取到的數據為空，請確認代號是否正確。' });
    }

    const cleanData = historicalData.map(d => ({
      date: d.date.toISOString().split('T')[0],
      close: Number(d.close.toFixed(2)),
      volume: d.volume
    })).slice(-30);

    const lastPrice = cleanData[cleanData.length - 1].close;
    console.log(`[系統] 數據抓取成功。最新收盤價：${lastPrice}。開始呼叫 Gemini 進行預報...\n`);

    const prompt = `
      你是專業的量化金融分析與預測專家。請針對股票/ETF代號 "${symbol}" 進行下一個交易日的漲跌幅預測。
      
      以下是該標的最近 30 個交易日的歷史收盤價與成交量數據：
      ${JSON.stringify(cleanData)}
      
      目前最新收盤價為：${lastPrice}。
      
      請啟動你的「Google 搜尋功能」，搜尋關於 "${symbol}" 的最新新聞、財報、重大總體經濟事件或產業動向。
      結合歷史價格趨勢（技術面）與網路上搜尋到的最新基本面消息，評估隔天該標的的走勢與可能波動。
      
      請絕對只返回一個標準的 JSON 格式回應（不要包含 \`\`\`json 標籤，不要有任何前後引言或多餘字符），格式必須完全如下：
      {
        "symbol": "${symbol}",
        "lastPrice": ${lastPrice},
        "prediction": "漲" 或 "跌" 或 "盤整",
        "upProbability": 漲的機率百分比（整數，如 65）,
        "downProbability": 跌的機率百分比（整數，如 35）,
        "targetRange": "預測隔日的價格波動區間，例如 150.5 ~ 153.2",
        "analysis": "結合技術面與今日最新網路消息的綜合深度量化分析報告（請用繁體中文撰寫，字數約 200 字左右）。"
      }
    `;

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash-preview-09-2025',
      contents: prompt,
      config: {
        tools: [{ googleSearch: {} }],
        responseMimeType: 'application/json'
      }
    });

    const resultText = response.text;
    
    let predictionJson;
    try {
      predictionJson = JSON.parse(resultText);
    } catch (parseErr) {
      console.error('[錯誤] AI 回傳格式解析失敗。原始回傳內容：', resultText);
      throw new Error('AI 回傳的資料格式不正確，解析失敗。');
    }

    console.log(`[系統] 預測成功！預測走勢：${predictionJson.prediction}\n`);

    res.json({
      success: true,
      chartData: cleanData,
      analysis: predictionJson
    });

  } catch (error) {
    console.error('[系統錯誤] 預測流程發生例外狀況:', error);
    res.status(500).json({ 
      success: false, 
      error: '伺服器分析失敗，請稍後再試。', 
      details: error.message 
    });
  }
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', time: new Date() });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`==================================================`);
  console.log(`🚀 AlphaPredict 智能預報後端已成功啟動！`);
  console.log(`📡 本地監聽端點: http://localhost:${PORT}`);
  console.log(`💡 請確保已在 .env 檔案中配置正確的 GEMINI_API_KEY`);
  console.log(`==================================================`);
});