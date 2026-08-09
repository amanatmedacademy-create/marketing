import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, CheckCircle2, ChevronDown, ChevronUp, CircleHelp, Clock3, Database, Info, Route, ShieldCheck, TriangleAlert, X } from 'lucide-react';
import './data-inspector.css';

export type DataQuality = 'fresh' | 'delayed' | 'partial' | 'error' | 'unknown';

export type DataBreakdownItem = {
  label: string;
  value: string;
  detail?: string;
};