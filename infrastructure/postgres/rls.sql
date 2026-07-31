-- Run after Prisma migrations. The application sets app.current_company_id inside each tenant transaction.

ALTER TABLE "CompanyMember" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RefreshToken" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS company_member_tenant_isolation ON "CompanyMember";
CREATE POLICY company_member_tenant_isolation ON "CompanyMember"
  USING ("companyId" = current_setting('app.current_company_id', true))
  WITH CHECK ("companyId" = current_setting('app.current_company_id', true));

DROP POLICY IF EXISTS refresh_token_tenant_isolation ON "RefreshToken";
CREATE POLICY refresh_token_tenant_isolation ON "RefreshToken"
  USING ("companyId" IS NULL OR "companyId" = current_setting('app.current_company_id', true))
  WITH CHECK ("companyId" IS NULL OR "companyId" = current_setting('app.current_company_id', true));

-- The API database role must not have BYPASSRLS. Migration/admin roles may remain privileged.
