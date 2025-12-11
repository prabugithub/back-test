// Angel One Symbol Tokens Database
// Source: Angel One API Documentation

export interface Symbol {
  token: string;
  name: string;
  symbol: string;
  exchange: string;
  instrumentType: 'EQUITY' | 'INDEX' | 'FUTIDX' | 'FUTSTK';
  category: 'Index' | 'Nifty 50' | 'Banking' | 'IT' | 'Auto' | 'Pharma' | 'FMCG' | 'Energy' | 'Metals' | 'Other';
}

export const SYMBOLS: Symbol[] = [
  // Indices
  { token: '99926000', name: 'Nifty 50', symbol: 'NIFTY', exchange: 'NSE_INDEX', instrumentType: 'INDEX', category: 'Index' },
  { token: '99926009', name: 'Nifty Bank', symbol: 'BANKNIFTY', exchange: 'NSE_INDEX', instrumentType: 'INDEX', category: 'Index' },
  { token: '99926037', name: 'Nifty Financial Services', symbol: 'FINNIFTY', exchange: 'NSE_INDEX', instrumentType: 'INDEX', category: 'Index' },
  { token: '99926074', name: 'Nifty Midcap 50', symbol: 'NIFTYMIDCAP50', exchange: 'NSE_INDEX', instrumentType: 'INDEX', category: 'Index' },
  { token: '99926013', name: 'Nifty IT', symbol: 'NIFTYIT', exchange: 'NSE_INDEX', instrumentType: 'INDEX', category: 'Index' },

  // Nifty 50 Stocks - Banking & Financial Services
  { token: '3045', name: 'State Bank of India', symbol: 'SBIN', exchange: 'NSE_EQ', instrumentType: 'EQUITY', category: 'Banking' },
  { token: '1333', name: 'HDFC Bank', symbol: 'HDFCBANK', exchange: 'NSE_EQ', instrumentType: 'EQUITY', category: 'Banking' },
  { token: '1660', name: 'ICICI Bank', symbol: 'ICICIBANK', exchange: 'NSE_EQ', instrumentType: 'EQUITY', category: 'Banking' },
  { token: '1922', name: 'Kotak Mahindra Bank', symbol: 'KOTAKBANK', exchange: 'NSE_EQ', instrumentType: 'EQUITY', category: 'Banking' },
  { token: '1795', name: 'Axis Bank', symbol: 'AXISBANK', exchange: 'NSE_EQ', instrumentType: 'EQUITY', category: 'Banking' },
  { token: '1594', name: 'IndusInd Bank', symbol: 'INDUSINDBK', exchange: 'NSE_EQ', instrumentType: 'EQUITY', category: 'Banking' },
  { token: '4668', name: 'Bajaj Finance', symbol: 'BAJFINANCE', exchange: 'NSE_EQ', instrumentType: 'EQUITY', category: 'Banking' },
  { token: '16669', name: 'Bajaj Finserv', symbol: 'BAJAJFINSV', exchange: 'NSE_EQ', instrumentType: 'EQUITY', category: 'Banking' },

  // IT Sector
  { token: '11536', name: 'Tata Consultancy Services', symbol: 'TCS', exchange: 'NSE_EQ', instrumentType: 'EQUITY', category: 'IT' },
  { token: '1594', name: 'Infosys', symbol: 'INFY', exchange: 'NSE_EQ', instrumentType: 'EQUITY', category: 'IT' },
  { token: '1660', name: 'HCL Technologies', symbol: 'HCLTECH', exchange: 'NSE_EQ', instrumentType: 'EQUITY', category: 'IT' },
  { token: '3506', name: 'Wipro', symbol: 'WIPRO', exchange: 'NSE_EQ', instrumentType: 'EQUITY', category: 'IT' },
  { token: '10794', name: 'Tech Mahindra', symbol: 'TECHM', exchange: 'NSE_EQ', instrumentType: 'EQUITY', category: 'IT' },
  { token: '18011', name: 'LTIMindtree', symbol: 'LTIM', exchange: 'NSE_EQ', instrumentType: 'EQUITY', category: 'IT' },

  // Energy & Power
  { token: '2885', name: 'Reliance Industries', symbol: 'RELIANCE', exchange: 'NSE_EQ', instrumentType: 'EQUITY', category: 'Energy' },
  { token: '3499', name: 'NTPC', symbol: 'NTPC', exchange: 'NSE_EQ', instrumentType: 'EQUITY', category: 'Energy' },
  { token: '3063', name: 'Power Grid Corporation', symbol: 'POWERGRID', exchange: 'NSE_EQ', instrumentType: 'EQUITY', category: 'Energy' },
  { token: '1330', name: 'Coal India', symbol: 'COALINDIA', exchange: 'NSE_EQ', instrumentType: 'EQUITY', category: 'Energy' },
  { token: '1624', name: 'ONGC', symbol: 'ONGC', exchange: 'NSE_EQ', instrumentType: 'EQUITY', category: 'Energy' },
  { token: '2952', name: 'BPCL', symbol: 'BPCL', exchange: 'NSE_EQ', instrumentType: 'EQUITY', category: 'Energy' },

  // Automobile
  { token: '3456', name: 'Maruti Suzuki', symbol: 'MARUTI', exchange: 'NSE_EQ', instrumentType: 'EQUITY', category: 'Auto' },
  { token: '16675', name: 'Tata Motors', symbol: 'TATAMOTORS', exchange: 'NSE_EQ', instrumentType: 'EQUITY', category: 'Auto' },
  { token: '10999', name: 'Mahindra & Mahindra', symbol: 'M&M', exchange: 'NSE_EQ', instrumentType: 'EQUITY', category: 'Auto' },
  { token: '1270', name: 'Bajaj Auto', symbol: 'BAJAJ-AUTO', exchange: 'NSE_EQ', instrumentType: 'EQUITY', category: 'Auto' },
  { token: '10447', name: 'Eicher Motors', symbol: 'EICHERMOT', exchange: 'NSE_EQ', instrumentType: 'EQUITY', category: 'Auto' },

  // FMCG
  { token: '1394', name: 'Hindustan Unilever', symbol: 'HINDUNILVR', exchange: 'NSE_EQ', instrumentType: 'EQUITY', category: 'FMCG' },
  { token: '1624', name: 'ITC', symbol: 'ITC', exchange: 'NSE_EQ', instrumentType: 'EQUITY', category: 'FMCG' },
  { token: '4717', name: 'Nestle India', symbol: 'NESTLEIND', exchange: 'NSE_EQ', instrumentType: 'EQUITY', category: 'FMCG' },
  { token: '4632', name: 'Britannia Industries', symbol: 'BRITANNIA', exchange: 'NSE_EQ', instrumentType: 'EQUITY', category: 'FMCG' },
  { token: '772', name: 'Asian Paints', symbol: 'ASIANPAINT', exchange: 'NSE_EQ', instrumentType: 'EQUITY', category: 'FMCG' },

  // Pharma
  { token: '3351', name: 'Sun Pharma', symbol: 'SUNPHARMA', exchange: 'NSE_EQ', instrumentType: 'EQUITY', category: 'Pharma' },
  { token: '1348', name: 'Dr Reddy\'s Laboratories', symbol: 'DRREDDY', exchange: 'NSE_EQ', instrumentType: 'EQUITY', category: 'Pharma' },
  { token: '1922', name: 'Cipla', symbol: 'CIPLA', exchange: 'NSE_EQ', instrumentType: 'EQUITY', category: 'Pharma' },
  { token: '14977', name: 'Divi\'s Laboratories', symbol: 'DIVISLAB', exchange: 'NSE_EQ', instrumentType: 'EQUITY', category: 'Pharma' },

  // Metals & Mining
  { token: '3499', name: 'Tata Steel', symbol: 'TATASTEEL', exchange: 'NSE_EQ', instrumentType: 'EQUITY', category: 'Metals' },
  { token: '1363', name: 'Hindalco Industries', symbol: 'HINDALCO', exchange: 'NSE_EQ', instrumentType: 'EQUITY', category: 'Metals' },
  { token: '1995', name: 'JSW Steel', symbol: 'JSWSTEEL', exchange: 'NSE_EQ', instrumentType: 'EQUITY', category: 'Metals' },

  // Conglomerate & Others
  { token: '11536', name: 'Larsen & Toubro', symbol: 'LT', exchange: 'NSE_EQ', instrumentType: 'EQUITY', category: 'Other' },
  { token: '5258', name: 'Adani Enterprises', symbol: 'ADANIENT', exchange: 'NSE_EQ', instrumentType: 'EQUITY', category: 'Other' },
  { token: '19113', name: 'Adani Ports', symbol: 'ADANIPORTS', exchange: 'NSE_EQ', instrumentType: 'EQUITY', category: 'Other' },
  { token: '236', name: 'Bharti Airtel', symbol: 'BHARTIARTL', exchange: 'NSE_EQ', instrumentType: 'EQUITY', category: 'Other' },
  { token: '467', name: 'UltraTech Cement', symbol: 'ULTRACEMCO', exchange: 'NSE_EQ', instrumentType: 'EQUITY', category: 'Other' },
  { token: '2181', name: 'Grasim Industries', symbol: 'GRASIM', exchange: 'NSE_EQ', instrumentType: 'EQUITY', category: 'Other' },
];

export const SYMBOL_CATEGORIES = [
  'All',
  'Index',
  'Nifty 50',
  'Banking',
  'IT',
  'Auto',
  'Pharma',
  'FMCG',
  'Energy',
  'Metals',
  'Other',
] as const;

// Helper function to search symbols
export function searchSymbols(query: string, category: string = 'All'): Symbol[] {
  const lowerQuery = query.toLowerCase().trim();

  let filtered = SYMBOLS;

  // Filter by category
  if (category !== 'All') {
    filtered = filtered.filter(s => s.category === category);
  }

  // Filter by search query
  if (lowerQuery) {
    filtered = filtered.filter(s =>
      s.name.toLowerCase().includes(lowerQuery) ||
      s.symbol.toLowerCase().includes(lowerQuery) ||
      s.token.includes(lowerQuery)
    );
  }

  return filtered;
}

// Helper to get symbol by token
export function getSymbolByToken(token: string): Symbol | undefined {
  return SYMBOLS.find(s => s.token === token);
}
