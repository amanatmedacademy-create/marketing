import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Check, MessageCircle, RefreshCw, Search, Send, X } from 'lucide-react';
import './marketing-chat.css';

type ChatMessage = {
  id: string;
  body: string;
  direction: 'INBOUND' | 'OUTBOUND';
  sentAt: string;
};

type ChatThread = {
  id: string;
  title?: string | null;
  phone?: string | null;
  channel: string;
  status: 'OPEN' | 'CLOSED';
  unreadCount?: number;
  lastMessage?: ChatMessage