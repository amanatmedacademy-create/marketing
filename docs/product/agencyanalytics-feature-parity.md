# IMDS Marketing Analytics — AgencyAnalytics Feature Parity Specification

- Status: Draft baseline
- Date: 2026-08-04
- Target repository: `amanatmedacademy-create/marketing`
- Target branch: `agent/agency-analytics-foundation`
- Goal: reproduce the publicly documented functional capabilities of AgencyAnalytics under the IMDS brand and architecture, without copying proprietary source code, trademarks, or protected visual assets.

## 1. Evidence boundary

This specification is derived from public AgencyAnalytics product pages and public Knowledge Base articles. It is sufficient to define the product architecture and most workflows, but it does not claim pixel-level knowledge of every private modal, menu, hover state, plan gate, or internal algorithm.

The following items still require a recorded walkthrough from a trial account before pixel-accurate implementation:

- exact information architecture and navigation order;
- every editor modal and right-side configuration panel;
- all empty, loading, permission-denied, disconnected, and partial-data states;
- complete widget catalog and per-widget settings;
- plan-specific entitlements and upgrade prompts;
- report email editor, approval flow, version history, and comments UX;
- current AI builder prompts, response states, and retry behavior;
- client portal login, navigation, messaging, and mobile details;
- exact bulk-operation confirmation and progress screens.

## 2. Product scope

IMDS Marketing Analytics is an agency operating system with five layers:

1. Agency and client management.
2. Marketing data-source connections and synchronization.
3. Dashboards, reports, widgets, templates, and client portals.
4. KPI monitoring, insights, anomaly detection, forecasting, and AI assistance.
5. Cross-client operations, roll-ups, white-label delivery, API, and automation.

## 3. Primary navigation

Recommended account-level navigation:

1. Clients
2. Data Sources
3. Dashboards
4. Reports
5. KPIs
6. Roll-ups
7. Templates
8. Bulk Operations
9. Users
10. Tasks and Messages
11. Integrations Catalog
12. API and Developer Tools
13. White Label
14. Settings and Billing

Recommended client-level navigation:

1. Overview
2. Dashboards
3. Reports
4. Data Sources
5. KPIs
6. Tasks
7. Messages
8. SEO
9. Settings

## 4. Agencies, clients, and groups

### 4.1 Agency

Required fields:

- name;
- language;
- timezone;
- default date format;
- default currency display policy;
- plan and entitlements;
- logo, favicon, colors, fonts, domains, email domain;
- security and session settings;
- API and MCP settings.

### 4.2 Client

Required fields:

- company name;
- website URL;
- logo and brand profile;
- timezone, country, language;
- lifecycle status: active, archived, deleted, restored;
- client group membership;
- assigned staff and client users;
- default dashboard and report templates;
- portal settings;
- internal notes and custom fields.

Client operations:

- create through a wizard;
- clone from another client;
- create from a client template;
- archive, restore, and permanently delete;
- move into groups;
- bulk apply templates;
- assign users;
- connect data sources;
- create internal-only dashboards;
- audit client changes.

### 4.3 Client groups

Required capabilities:

- create and rename groups;
- assign multiple clients;
- filter clients, reports, dashboards, KPIs, and data sources by group;
- use groups as targets in bulk operations and roll-ups;
- set group-level permissions.

## 5. Users and permissions

Roles:

- Account Admin;
- Staff;
- Client User;
- optional IMDS roles: Owner, Billing Admin, Analyst, Viewer.

Permission model must support three independent layers:

1. Client access: which clients a user may access.
2. Action permissions: which operations the user may perform.
3. Dashboard and integration visibility: which dashboards, sections, integrations, and metrics the user may see.

Required permissions:

- manage clients;
- manage users;
- manage account settings;
- manage billing;
- use bulk actions;
- create or edit dashboards;
- create, approve, schedule, send, download, or delete reports;
- connect, reconnect, or remove data sources;
- manage keywords and SEO data;
- create KPIs and alerts;
- use AI tools;
- manage white-label settings;
- manage API keys;
- login as user for permission verification;
- staff-only content visibility.

All authorization must be tenant-scoped and server-enforced. Hiding a control in the browser is not authorization.

## 6. Data sources and integration catalog

### 6.1 Catalog

The platform must provide a searchable integration catalog grouped by category:

- Paid Ads;
- Analytics;
- SEO;
- Social;
- Ecommerce;
- CRM and Marketing Automation;
- Email Marketing;
- Call Tracking;
- Local and Reviews;
- Databases and Warehouses;
- Custom Data and Files.

Initial priority integrations:

1. Meta Ads
2. TikTok Ads
3. Google Ads
4. Google Analytics 4
5. Google Search Console
6. Google Business Profile
7. Google Sheets
8. CallRail or equivalent
9. HubSpot
10. Shopify

Later integrations should use the same connector contract.

### 6.2 Connection methods

Supported authentication types:

- OAuth 2.0 authorization code;
- API key and secret;
- username and password where a provider requires it;
- database connection;
- file upload;
- webhook or push subscription;
- service account.

OAuth requirements:

- server-generated state with short expiry;
- PKCE when supported;
- encrypted token storage;
- refresh-token rotation;
- exact account/advertiser/property selection;
- account currency and timezone capture;
- token expiry and reconnect detection;
- revocation and disconnect;
- one authorization shared across multiple clients when permitted;
- reauthorization of all related data sources from one OAuth grant.

### 6.3 Account-level Data Sources page

Required columns:

- integration;
- client;
- account/property name;
- external account ID;
- status;
- connected by;
- last successful sync;
- last attempted sync;
- error summary;
- currency;
- timezone;
- actions.

Required filters:

- integration;
- client;
- client group;
- connected/disconnected/error;
- owner;
- last-sync age.

Required actions:

- connect new data source;
- reconnect or reauthorize;
- edit account selection;
- trigger manual sync;
- backfill a date range;
- remove connection;
- inspect sync history;
- inspect permissions required by provider.

Staff and Admin users must receive in-app notifications when a connection becomes invalid or disconnected.

### 6.4 Currency rule

The native advertising-account currency is the source of truth.

- USD account: display `$` and USD formatting.
- KZT account: display `₸` and KZT formatting.
- EUR account: display `€` and EUR formatting.
- other account: display the provider-reported ISO currency.

Different native currencies must never be added into one monetary total without explicit conversion. Mixed-currency views must show separate totals by currency. Optional KZT or USD conversion must be a secondary display, with stored FX source, rate, date, and calculation timestamp.

Historical conversion must use the exchange rate for the metric date, not the current rate.

## 7. Connector and synchronization runtime

Each connector must implement:

- authorization and account discovery;
- supported dimensions and metrics catalog;
- date-range limits;
- pagination;
- rate-limit handling;
- retry with exponential backoff and jitter;
- incremental synchronization;
- historical backfill;
- idempotent writes;
- deletion or correction reconciliation;
- provider timezone normalization;
- provider currency preservation;
- raw-payload retention policy;
- data-quality checks;
- sync observability;
- reconnect requirements.

Sync states:

- queued;
- running;
- succeeded;
- partial;
- failed;
- cancelled;
- waiting for authorization;
- rate limited.

Required sync metadata:

- provider request ID;
- cursor;
- period;
- rows received;
- rows accepted;
- rows rejected;
- API calls;
- retry count;
- rate-limit reset;
- failure category;
- human-readable error;
- started and finished timestamps.

## 8. Canonical marketing data model

The canonical fact layer must preserve:

- agency ID;
- client ID;
- data-source ID;
- provider;
- account ID and name;
- campaign ID and name;
- ad-group ID and name;
- ad ID and name;
- metric date;
- native currency;
- timezone;
- metric key;
- metric value;
- attribution window;
- source version;
- ingested timestamp.

Common paid-ad metrics:

- spend;
- impressions;
- reach;
- frequency;
- clicks;
- link clicks;
- landing-page views;
- CTR;
- CPC;
- CPM;
- video views and video quartiles;
- leads;
- qualified leads;
- appointments;
- arrivals;
- purchases or sales;
- revenue or purchase value;
- CPL;
- CAC;
- ROAS;
- ROI.

Ratios and costs must be calculated after aggregation, not summed from row-level derived metrics.

## 9. Dashboards

### 9.1 Dashboard lifecycle

Required actions:

- create from blank;
- create from template;
- clone;
- rename;
- reorder;
- duplicate between clients;
- mark internal-only;
- publish to client portal;
- share by link;
- present full screen;
- embed externally;
- archive and restore.

### 9.2 Editor

The editor must support:

- drag-and-drop widgets;
- resizable grid;
- pages or sections;
- undo and redo;
- autosave;
- version history;
- desktop and mobile preview;
- reusable section templates;
- theme selection;
- widget search;
- data-source filter;
- metric and dimension selection;
- comparison period;
- custom date ranges;
- dynamic date ranges;
- per-widget filters;
- annotations;
- thresholds;
- conditional formatting;
- forecasting and anomaly toggles where supported.

### 9.3 Widget catalog

Minimum widget types:

- stat card;
- comparison stat;
- line chart;
- area chart;
- bar chart;
- stacked bar;
- pie or donut;
- table;
- pivot table;
- map;
- funnel;
- progress bar;
- KPI widget;
- benchmark widget;
- image;
- rich text;
- heading;
- divider;
- spacer;
- iframe or external embed;
- custom metric;
- AI summary;
- AI-generated metric group.

Each widget must store query definition separately from presentation settings.

## 10. Reports

### 10.1 Report formats

- Document: vertical, web and PDF-oriented.
- Slide deck: landscape, presentation-oriented.

### 10.2 Report lifecycle

Required actions:

- create from blank;
- create from report template;
- clone existing report;
- copy content from dashboard;
- add multi-client data;
- save draft;
- preview;
- approve;
- send once;
- schedule recurring delivery;
- pause and resume schedule;
- download PDF;
- share live web link;
- create snapshot export;
- archive, restore, and delete;
- restore a previous version.

### 10.3 Scheduling

Required schedule settings:

- daily, weekly, monthly, quarterly, and custom recurrence;
- timezone;
- delivery date and time;
- reporting period;
- comparison period;
- recipient list;
- CC and BCC;
- email template;
- subject and message;
- PDF attachment or live link;
- approval requirement;
- failure retries;
- delivery log.

### 10.4 Collaboration

- internal comments anchored to report locations;
- @mentions for Staff/Admin users with report access;
- open and resolved threads;
- notifications;
- client users excluded from internal comments unless explicitly implemented as a separate client-facing comment system.

## 11. Templates

Template types:

- client template;
- report template;
- dashboard section template;
- report section template;
- email template;
- white-label theme.

Required operations:

- create from scratch;
- clone template;
- create from existing client, report, dashboard, or section;
- preview;
- version;
- apply to one target;
- bulk apply to multiple clients;
- duplicate and archive;
- permission control.

Applying a section template creates an independent instance; future instance edits do not mutate the original template unless the user explicitly runs an apply-template bulk action.

## 12. KPIs, goals, budgets, and alerts

AgencyAnalytics has consolidated Goals and Alerts into a KPI workflow. IMDS should implement one KPI entity with optional target and notification rules.

KPI definition:

1. metric;
2. dimensions and filters;
3. target condition and target value;
4. date scope or recurrence;
5. optional alert condition;
6. recipients and channels;
7. visualization type.

Visualizations:

- progress bar;
- stat;
- line chart;
- benchmark comparison.

Alert conditions:

- above or below threshold;
- percentage change;
- budget pacing;
- missing data;
- anomaly detected;
- forecast predicts miss;
- data source disconnected.

KPI surfaces:

- account-level KPI center;
- client-level KPI center;
- dashboard/report widget;
- notifications tray;
- email or messaging delivery.

## 13. Insights, benchmarks, anomaly detection, and forecasting

### 13.1 Metric Insights

From a compatible widget, a user must be able to open a detailed metric-insights view containing:

- historical trend;
- period comparison;
- benchmark comparison;
- anomalies;
- forecast;
- AI-generated highlights;
- AI question interface;
- filters and date range.

### 13.2 Benchmarks

Required filters:

- metric;
- country;
- industry;
- platform;
- optional account type.

The baseline public behavior compares a client metric with an industry median over the latest 30-day period. IMDS must clearly label population, time range, sample threshold, and percentile or median methodology.

### 13.3 Anomaly detection

Supported primarily on line and area charts.

Implementation requirements:

- configurable seasonality;
- minimum data requirement;
- confidence interval;
- positive and negative anomalies;
- explanation of expected versus actual;
- false-positive feedback;
- tenant-safe aggregate training data.

### 13.4 Forecasting

Required output:

- forecast value;
- optimistic range;
- pessimistic range;
- current value;
- historical input period;
- model freshness;
- confidence indicator.

Forecasting must never silently combine incompatible currencies.

## 14. AI reporting

AI functions:

- AI Summary;
- AI performance analysis;
- AI Widgets from a prompt;
- AI Page Builder for dashboard or report pages;
- Ask AI inside Metric Insights;
- suggested prompts;
- iterative refinement;
- preview before insertion.

Safety and product requirements:

- AI must cite the exact underlying metrics and date ranges used;
- no unsupported causal claims;
- highlight unavailable or incomplete data;
- keep tenant data isolated;
- store prompt and output audit metadata;
- permit regeneration;
- permit manual editing;
- support Russian, Kazakh, and English;
- mark AI-generated content visibly.

## 15. Roll-up reports and dashboards

Purpose: aggregate data across clients, brands, branches, or locations.

Required capabilities:

- select clients or client groups;
- use common metrics across selected data sources;
- aggregate totals and averages;
- display a roll-up table with each client plus aggregate values;
- support up to at least 25 metrics per roll-up table;
- dashboards and reports;
- forecasting and anomaly detection on supported widgets;
- explicit data-freshness label;
- separate mixed currencies or convert using an explicit FX policy.

The public product notes that roll-up data can refresh on a different schedule than single-client data; IMDS must expose its own freshness SLA rather than hide this difference.

## 16. Bulk Operations

Supported targets:

- reports;
- dashboard sections;
- schedules;
- email messages;
- themes;
- clients and groups.

Supported actions:

- add from template;
- apply template and replace content;
- remove;
- download;
- pause or resume schedules;
- update schedule;
- update email message;
- update theme.

Every bulk operation must be asynchronous and auditable:

- queued job;
- preview and confirmation;
- progress;
- per-target status;
- retry failed targets;
- partial completion state;
- rollback where technically possible;
- role restriction for destructive operations.

## 17. White label and client portal

### 17.1 White label

Required settings:

- platform logo;
- client-specific logo;
- favicon;
- agency colors;
- widget colors;
- fonts;
- background images;
- reusable themes;
- custom subdomain;
- custom root domain on supported plans;
- custom sender email and DNS verification;
- report cover pages;
- branded browser title;
- multiple white-label profiles;
- branded responsive portal.

### 17.2 Client portal

Required capabilities:

- client authentication;
- dashboard access;
- report access;
- client-specific permissions;
- tasks;
- messages;
- KPI visibility;
- downloads and shared links;
- mobile-responsive navigation;
- agency branding only;
- optional client branding profile.

## 18. Tasks and client messaging

Tasks:

- client and internal tasks;
- assignee;
- due date;
- status;
- priority;
- comments;
- attachments;
- report/dashboard links;
- notification rules;
- staff-only visibility.

Client messaging:

- contextual messages attached to client, dashboard, report, or metric;
- staff-client thread;
- unread state;
- email or in-app notification;
- permission and retention controls.

This module must remain separate from internal report comments.

## 19. SEO tools

Feature-parity scope must eventually include:

- keyword rank tracking;
- location and device configuration;
- SERP features;
- keyword groups and tags;
- competitor tracking;
- page-level ranking views;
- backlink monitoring;
- site audit;
- technical issue prioritization;
- Google Search Console integration;
- Bing Webmaster integration;
- local SEO and reviews integrations;
- SEO dashboards and automated reports.

SEO is a separate domain and should not be mixed into paid-ad canonical entities.

## 20. Custom data, metrics, and Views

Custom data sources:

- Google Sheets;
- CSV and XLSX upload;
- PostgreSQL, MySQL, BigQuery, Redshift;
- external API connector;
- manual metric entry.

Custom metric definition:

- name and label;
- formula;
- dependencies;
- unit and format;
- aggregation;
- allowed dimensions;
- null behavior;
- division-by-zero behavior;
- currency compatibility rules.

Views:

- combine data from multiple integrations;
- select compatible dimensions;
- rename columns;
- calculated fields;
- filters;
- sorting;
- reusable in widgets and reports;
- query-cost limits.

## 21. API, MCP, and automation

Required developer functions:

- tenant-scoped API keys;
- scopes;
- key rotation and revocation;
- audit log;
- client CRUD;
- user CRUD;
- report and dashboard automation;
- data-source status;
- KPI access;
- query endpoint for normalized metrics;
- webhook events;
- federated login or portal SSO;
- MCP server for authorized analytics queries.

The existing AAQL foundation should evolve into a typed query layer with provider-independent dimensions, metrics, filters, grouping, comparison periods, pagination, and currency policy.

## 22. Non-functional requirements

### Security

- encrypted provider credentials;
- PostgreSQL row-level tenant isolation;
- agency ID in every query and job;
- short-lived signed URLs;
- audit log for access and mutations;
- provider least-privilege scopes;
- CSRF-safe OAuth;
- webhook signature verification;
- no service-role or provider secrets in frontend bundles.

### Reliability

- idempotent jobs;
- dead-letter queue;
- retry policy;
- backfill reconciliation;
- sync freshness monitoring;
- report-delivery retries;
- per-provider circuit breaker;
- disaster recovery;
- migration rollback plan.

### Performance

- cached widget queries;
- ClickHouse for high-cardinality time series;
- asynchronous PDF rendering;
- pre-aggregations for roll-ups;
- pagination and virtualization for large tables;
- date-partitioned retention.

### Localization

- Russian, Kazakh, English;
- locale-specific number and date formatting;
- native advertising currency;
- agency and client timezone;
- report delivery timezone.

## 23. Delivery sequence

### Phase 0 — Foundation

- NestJS API and Fastify;
- PostgreSQL tenant metadata and RLS;
- ClickHouse facts;
- Redis/BullMQ;
- connector SDK;
- object storage;
- observability;
- compatibility gateway from existing frontend.

### Phase 1 — Paid Ads MVP

- Clients;
- Data Sources;
- Meta Ads;
- TikTok Ads;
- Google Ads;
- currency-correct dashboards;
- account/campaign/ad-group/ad views;
- CSV export;
- sync status and reconnect;
- canonical metric query.

### Phase 2 — Reporting Core

- dashboard editor;
- report editor;
- templates;
- scheduled email delivery;
- PDF rendering;
- white-label basics;
- client portal;
- users and permissions.

### Phase 3 — Agency Operations

- KPIs and alerts;
- roll-ups;
- bulk operations;
- tasks;
- client messaging;
- report comments and version history;
- API keys and automation.

### Phase 4 — Analytics and AI

- Metric Insights;
- benchmarks;
- anomaly detection;
- forecasting;
- AI Summary;
- AI Widgets;
- AI Page Builder;
- Ask AI.

### Phase 5 — SEO and Extended Integrations

- rank tracker;
- site audit;
- backlinks;
- GA4 and Search Console depth;
- social, ecommerce, CRM, email, call tracking;
- database and custom-data connectors;
- MCP.

## 24. Definition of feature parity

A module is considered parity-complete only when:

1. its primary user workflows are implemented;
2. permissions are enforced server-side;
3. loading, empty, error, disconnected, and stale-data states exist;
4. mobile behavior is defined;
5. audit and observability exist;
6. export and sharing behavior is defined where applicable;
7. automated tests cover tenant isolation and key workflows;
8. the implementation is validated against a current trial walkthrough;
9. the UI is original IMDS design, not a copied AgencyAnalytics skin.

## 25. Trial walkthrough capture checklist

Record one uninterrupted desktop walkthrough at 1440×900 or higher and separate mobile captures.

Capture:

1. Account onboarding and demo client.
2. Client list, tile/list views, groups, filters, add-client wizard, archive/restore.
3. Account-level Data Sources, connection wizard, reconnect, account selection, error states.
4. Every dashboard editor panel and widget category.
5. Widget configuration for stat, chart, table, map, KPI, text, image, embed, and AI widgets.
6. Dashboard share, presentation, embed, permissions, internal dashboard.
7. Document report and slide-deck report creation.
8. Report scheduling, approval, email content, PDF, web link, version history, comments.
9. Report, section, dashboard, client, and email templates.
10. KPI creation and notification settings.
11. Roll-up builder and roll-up table.
12. Bulk Operations wizard and job history.
13. Users, roles, permissions, dashboard visibility, and Login as User.
14. White-label profiles, themes, domains, sender email, portal.
15. Tasks and client messaging.
16. Metric Insights, benchmarks, anomaly detection, forecasting.
17. AI Summary, AI Widgets, AI Page Builder, Ask AI.
18. API settings, API keys, SSO/federated login, and MCP if visible.
19. Billing plan gates and upgrade messages.
20. All empty and failure states encountered.

## 26. Public sources used

- https://agencyanalytics.com/features
- https://agencyanalytics.com/features/white-label
- https://agencyanalytics.com/features/agency-client-portals
- https://agencyanalytics.com/features/ai-reporting-tools
- https://agencyanalytics.com/integrations
- https://help.agencyanalytics.com/en/collections/10718166-build-reports-dashboards
- https://help.agencyanalytics.com/en/collections/140338-connect-your-data
- https://help.agencyanalytics.com/en/articles/10344666-create-and-manage-clients
- https://help.agencyanalytics.com/en/articles/9774477-create-and-manage-users
- https://help.agencyanalytics.com/en/articles/15349528-edit-user-permissions
- https://help.agencyanalytics.com/en/articles/3530399-manage-integrations
- https://help.agencyanalytics.com/en/articles/8602799-reauthorize-or-reconnect-a-data-source
- https://help.agencyanalytics.com/en/articles/9672045-widgets-overview
- https://help.agencyanalytics.com/en/articles/4706526-report-overview
- https://help.agencyanalytics.com/en/articles/15592180-create-manage-reports
- https://help.agencyanalytics.com/en/articles/15234399-using-report-templates
- https://help.agencyanalytics.com/en/articles/11174784-dashboard-templates
- https://help.agencyanalytics.com/en/articles/7061766-create-and-apply-report-section-templates
- https://help.agencyanalytics.com/en/articles/5395216-create-custom-goals
- https://help.agencyanalytics.com/en/articles/12091955-roll-up-reports-and-dashboards
- https://help.agencyanalytics.com/en/articles/9034168-bulk-actions
- https://help.agencyanalytics.com/en/articles/10088379-benchmarks
- https://help.agencyanalytics.com/en/articles/10114781-anomaly-detection
- https://help.agencyanalytics.com/en/articles/10114779-forecasting
- https://help.agencyanalytics.com/en/articles/10763213-metric-insights
- https://help.agencyanalytics.com/en/articles/12877937-ai-widgets
- https://help.agencyanalytics.com/en/articles/13853848-ai-page-builder
