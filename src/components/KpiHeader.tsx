"use client";

import React from "react";
import { Menu, ShieldCheck } from "lucide-react";
import { formatBRL } from "@/lib/format";
import { DashboardSection } from "./Sidebar";

const SECTION_TITLES: Record<DashboardSection, string> = {
  overview: "Visão Geral",
  queue: "Fila de Tratativas",
  radar: "Causas-Raiz & Bloqueios",
  triage: "Triagem Automática",
  claims: "Sinistros & Histórico",
};

interface KpiHeaderProps {
  activeSection: DashboardSection;
  totalActiveExposureBRL: number;
  totalProtectedSavingsBRL: number;
  resolvedTreatmentsCount: number;
  dailyCapacity: number;
  claimsTotalBRL: number;
  activeContainmentsCount: number;
  onOpenMobileMenu: () => void;
}

export function KpiHeader({
  activeSection,
  totalActiveExposureBRL,
  totalProtectedSavingsBRL,
  resolvedTreatmentsCount,
  dailyCapacity,
  claimsTotalBRL,
  activeContainmentsCount,
  onOpenMobileMenu,
}: KpiHeaderProps) {
  return (
    <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center justify-between border-b border-slate-200 bg-white/95 px-4 backdrop-blur sm:px-6">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onOpenMobileMenu}
          className="rounded-lg border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-50 lg:hidden"
        >
          <Menu className="h-4 w-4" />
        </button>

        <div className="flex items-center gap-2.5">
          <h1 className="text-sm font-bold text-slate-900 sm:text-base">
            {SECTION_TITLES[activeSection]}
          </h1>
          <span className="hidden rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500 sm:inline-block">
            Ref. 30/09/2026
          </span>
          {activeContainmentsCount > 0 && (
            <span className="hidden items-center gap-1 rounded-md bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 border border-emerald-200 md:inline-flex">
              <ShieldCheck className="h-3 w-3" />
              {activeContainmentsCount} bloqueio{activeContainmentsCount > 1 ? "s" : ""} ativo{activeContainmentsCount > 1 ? "s" : ""}
            </span>
          )}
        </div>
      </div>

      {/* Compact Inline Metric Strip */}
      <div className="flex items-center gap-2 sm:gap-4 text-xs">
        <div className="flex items-center gap-1.5">
          <span className="hidden text-slate-500 sm:inline">Risco:</span>
          <strong className="font-semibold text-rose-600">
            {formatBRL(totalActiveExposureBRL, true)}
          </strong>
        </div>

        <div className="h-3.5 w-px bg-slate-200" />

        <div className="flex items-center gap-1.5">
          <span className="hidden text-slate-500 sm:inline">Protegido:</span>
          <strong className="font-semibold text-emerald-600">
            +{formatBRL(totalProtectedSavingsBRL, true)}
          </strong>
        </div>

        <div className="hidden h-3.5 w-px bg-slate-200 md:block" />

        <div className="hidden items-center gap-1.5 md:flex">
          <span className="text-slate-500">Meta hoje:</span>
          <strong className="font-mono font-semibold text-slate-900">
            {resolvedTreatmentsCount}/{dailyCapacity}
          </strong>
        </div>

        {claimsTotalBRL > 0 && (
          <>
            <div className="hidden h-3.5 w-px bg-slate-200 xl:block" />
            <div className="hidden items-center gap-1.5 xl:flex">
              <span className="text-slate-500">Sinistros:</span>
              <strong className="font-semibold text-slate-900">
                {formatBRL(claimsTotalBRL, true)}
              </strong>
            </div>
          </>
        )}
      </div>
    </header>
  );
}
