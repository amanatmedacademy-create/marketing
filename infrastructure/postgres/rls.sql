-- Application requests must set app.current_company_id inside a transaction.

ALTER TABLE "CompanyMember" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Pipeline" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PipelineStage" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Contact" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Deal" ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['CompanyMember','Pipeline','PipelineStage','Contact','Deal'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', table_name);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING ("companyId" = current_setting(''app.current_company_id'', true)) WITH CHECK ("companyId" = current_setting(''app.current_company_id'', true))',
      table_name
    );
  END LOOP;
END $$;

-- Runtime DB role must not have BYPASSRLS.
