import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, Columns3, Download, Filter, Save, Search, SlidersHorizontal, Trash2, X } from 'lucide-react';
import '../ads-manager.css';

type Level = 'campaign' | 'adset' | 'ad';
type SortKey = 'name' | 'spend' | 'impressions' | 'reach' | 'clicks' | 'ctr' | 'cpm' | 'leads' | 'cost_per_result'