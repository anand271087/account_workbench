// Account ↔ Beroe product roster grid.
//
// Reads /api/v1/accounts/:id/products and renders the canonical 28-row
// catalogue as a 4-column grid with three states:
//   ✓ green   — purchased=true
//   ·  grey   — purchased=false
//   ?  hatch  — purchased=null (unknown / blank in source)
//
// Used by:
//   * Growth & Pipeline → AccountPlanTab (primary surface)
//   * Business Review modal slide picker (purchase badges per module slide)
//   * Analytics tab (per-sub-tab "you don't own this" banner)

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import {
  PRODUCT_CATALOGUE,
  type ProductsResponse,
  type ProductRow,
} from "@/types/account_product";

const BRAND = {
  green: "#6EC457",
  greenSoft: "#dcfce7",
  amber: "#F0BC41",
  indigo: "#4A00F8",
  cardBorder: "#e4eaf6",
  bgSoft: "#f7f9fd",
  t1: "#0d1b2e",
  t2: "#5a7896",
  t3: "#8496b0",
};

export function useProductRoster(accountId: string | null) {
  return useQuery<ProductsResponse>({
    queryKey: ["account-products", accountId],
    queryFn: () => api.get(`/api/v1/accounts/${accountId}/products`),
    enabled: !!accountId,
    staleTime: 60_000,
  });
}

function StatusCell({ p }: { p: ProductRow | undefined }) {
  if (!p || p.purchased === null) {
    return (
      <span
        style={{
          fontSize: 11,
          color: BRAND.t3,
          fontWeight: 700,
        }}
        title="Unknown — no data in source"
      >
        ?
      </span>
    );
  }
  if (p.purchased) {
    return (
      <span
        style={{
          color: BRAND.green,
          fontSize: 14,
          fontWeight: 800,
        }}
        title="Purchased"
      >
        ✓
      </span>
    );
  }
  return (
    <span style={{ color: BRAND.t3, fontSize: 12 }} title="Not purchased">
      ·
    </span>
  );
}

export function ProductRoster({ accountId }: { accountId: string }) {
  const { data, isLoading } = useProductRoster(accountId);
  const byKey: Record<string, ProductRow> = {};
  for (const row of data?.items ?? []) byKey[row.product_key] = row;

  const purchased = data?.items.filter((r) => r.purchased === true).length ?? 0;
  const unknown = data?.items.filter((r) => r.purchased === null).length ?? 0;
  const total = PRODUCT_CATALOGUE.length;

  return (
    <div
      style={{
        background: "#fff",
        border: `1px solid ${BRAND.cardBorder}`,
        borderRadius: 12,
        padding: 14,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", marginBottom: 10 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: BRAND.t1 }}>
          Product Roster · 28 Beroe products
        </div>
        <span style={{ flex: 1 }} />
        <div style={{ fontSize: 11, color: BRAND.t3, fontWeight: 600 }}>
          {isLoading ? (
            "Loading…"
          ) : (
            <>
              <span style={{ color: BRAND.green, fontWeight: 800 }}>
                ✓ {purchased}
              </span>
              <span style={{ margin: "0 8px" }}>·</span>
              {unknown > 0 && (
                <>
                  <span>? {unknown} unknown</span>
                  <span style={{ margin: "0 8px" }}>·</span>
                </>
              )}
              <span>{total} total</span>
            </>
          )}
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: 6,
        }}
      >
        {PRODUCT_CATALOGUE.map(({ key, label }) => {
          const row = byKey[key];
          const ownedBg =
            row?.purchased === true
              ? BRAND.greenSoft
              : row?.purchased === false
                ? BRAND.bgSoft
                : "#f5f3ff";
          return (
            <div
              key={key}
              style={{
                background: ownedBg,
                borderRadius: 6,
                padding: "6px 8px",
                display: "flex",
                alignItems: "center",
                gap: 8,
                minHeight: 28,
              }}
              title={
                row?.purchased === true
                  ? "Purchased"
                  : row?.purchased === false
                    ? "Not purchased"
                    : "Unknown (blank in source)"
              }
            >
              <div style={{ width: 16, textAlign: "center" }}>
                <StatusCell p={row} />
              </div>
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: row?.purchased === false ? BRAND.t3 : BRAND.t1,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  flex: 1,
                }}
              >
                {label}
              </div>
            </div>
          );
        })}
      </div>

      <div style={{ marginTop: 10, fontSize: 10, color: BRAND.t3 }}>
        ✓ purchased  ·  · not purchased  ·  ? unknown (blank in source)
      </div>
    </div>
  );
}
