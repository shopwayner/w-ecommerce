"use client";

import Link from "next/link";
import { useState } from "react";
import {
  Check,
  ChevronDown,
  CloudUpload,
  Gem,
  Headphones,
  PackageCheck,
  Rocket,
  ShieldCheck,
  Sparkles,
  Workflow,
  X
} from "lucide-react";
import { cn } from "@/lib/utils";

type BillingCycle = "monthly" | "yearly";

const plans = [
  {
    name: "PRO",
    subtitle: "Para quem esta comecando",
    monthly: "R$ 129/mes",
    yearly: "R$ 1.290/ano",
    badge: null,
    cta: "Assinar Pro",
    tone: "standard",
    benefits: ["Gestao de produtos e pedidos", "Integracao com Marketplaces", "Relatorios basicos", "Suporte por e-mail"]
  },
  {
    name: "PLUS",
    subtitle: "Para negocios em crescimento",
    monthly: "R$ 279/mes",
    yearly: "R$ 2.790/ano",
    badge: "Mais popular",
    cta: "Assinar Plus",
    tone: "popular",
    benefits: ["Tudo do plano PRO", "Automacoes ilimitadas", "Relatorios avancados", "Suporte prioritario 24/7"]
  },
  {
    name: "MATRIX",
    subtitle: "Maximo desempenho e inteligencia",
    monthly: "R$ 599/mes",
    yearly: "R$ 5.990/ano",
    badge: null,
    cta: "Falar com vendas",
    tone: "premium",
    benefits: ["Tudo do plano PLUS", "IA avancada e previsoes", "Suporte executivo dedicado", "SLA e performance premium"]
  }
];

const benefitStrip = [
  { title: "Implantacao rapida", detail: "Comece a operar em dias, sem meses de projeto.", icon: Rocket },
  { title: "Migracao facilitada", detail: "Traga dados com seguranca e sem complicacao.", icon: CloudUpload },
  { title: "Seguranca de ponta", detail: "Criptografia, isolamento e boas praticas LGPD.", icon: ShieldCheck },
  { title: "Integracoes avancadas", detail: "Conecte ERPs, marketplaces e plataformas.", icon: Workflow },
  { title: "Suporte prioritario", detail: "Especialistas prontos para apoiar sua operacao.", icon: Headphones }
];

const comparisonRows = [
  ["Usuarios", "Ate 3 usuarios", "Ate 10 usuarios", "Ilimitado"],
  ["Operacoes por mes", "Ate 10.000", "Ate 50.000", "Ilimitado"],
  ["Integracoes", "Ate 3 integracoes", "Ate 10 integracoes", "Ilimitado"],
  ["Dashboard e relatorios", "included", "included", "included"],
  ["Automacoes", "Limitado (ate 10)", "Ilimitado", "Ilimitado"],
  ["IA e previsoes", "none", "Limitado", "included"],
  ["Suporte", "Por e-mail", "Prioritario 24/7", "Executivo dedicado"],
  ["Onboarding", "Autoguiado", "Assistido", "Personalizado"]
];

const faqItems = [
  {
    question: "Posso trocar de plano depois?",
    answer: "Sim. Voce pode evoluir ou ajustar o plano conforme a operacao cresce. Nesta etapa, a troca e apenas comercial e ainda nao aciona cobranca automatica."
  },
  {
    question: "Existe fidelidade?",
    answer: "Os planos foram pensados para flexibilidade. Condicoes comerciais finais serao definidas antes do checkout real."
  },
  {
    question: "O que esta incluso no onboarding?",
    answer: "Configuracao inicial, orientacao de uso e apoio para organizar cadastros, canais e rotinas de operacao."
  },
  {
    question: "Como funciona a cobranca anual?",
    answer: "O anual mostra a economia planejada de 17%. Pagamento real e assinatura automatica ainda nao foram implementados."
  }
];

export function PlansPage() {
  const [billing, setBilling] = useState<BillingCycle>("monthly");
  const [openFaq, setOpenFaq] = useState(0);
  const [message, setMessage] = useState("");

  function handlePlanClick(planName: string) {
    setMessage(planName === "MATRIX" ? "Contato comercial em breve." : "Checkout em breve.");
  }

  return (
    <main className="plans-public-shell min-h-screen bg-matrix-bg text-matrix-fg">
      <div className="login-gold-lines" aria-hidden="true" />
      <PublicHeader />

      <section className="relative mx-auto grid w-full max-w-[1580px] gap-8 px-4 pb-8 pt-10 sm:px-6 lg:grid-cols-[0.85fr_1.6fr] lg:px-10 lg:pt-14">
        <div className="relative z-10">
          <p className="mb-4 inline-flex items-center gap-2 rounded-full border border-matrix-gold/30 bg-matrix-goldSoft/40 px-3 py-1 text-sm font-semibold text-matrix-goldDark">
            <Sparkles className="h-4 w-4" />
            Planos comerciais
          </p>
          <h1 className="max-w-xl text-4xl font-bold leading-tight tracking-normal text-matrix-fg sm:text-5xl">
            Planos para cada fase do <span className="text-matrix-goldDark dark:text-matrix-gold">seu negocio</span>
          </h1>
          <p className="mt-5 max-w-lg text-lg leading-8 text-matrix-muted">
            Escolha o plano ideal para crescer com automacao, integracoes e inteligencia operacional.
          </p>

          <div className="mt-8 inline-flex rounded-xl border border-matrix-border bg-white/70 p-1 shadow-glow backdrop-blur dark:bg-black/35">
            <button
              className={cn("rounded-lg px-7 py-2.5 text-sm font-bold transition", billing === "monthly" ? "bg-matrix-gold text-black shadow-gold" : "text-matrix-muted hover:text-matrix-fg")}
              onClick={() => setBilling("monthly")}
              type="button"
            >
              Mensal
            </button>
            <button
              className={cn("rounded-lg px-7 py-2.5 text-sm font-bold transition", billing === "yearly" ? "bg-matrix-gold text-black shadow-gold" : "text-matrix-muted hover:text-matrix-fg")}
              onClick={() => setBilling("yearly")}
              type="button"
            >
              Anual
            </button>
          </div>
          <p className="mt-4 inline-flex items-center gap-2 rounded-full bg-green-500/12 px-3 py-1 text-sm font-semibold text-green-700 dark:text-green-300">
            <Check className="h-4 w-4" />
            Economize 17% no anual
          </p>
        </div>

        <div className="relative z-10 grid gap-4 lg:grid-cols-3">
          {message ? (
            <div className="absolute -top-12 right-0 z-20 rounded-full border border-matrix-gold/35 bg-matrix-panel px-4 py-2 text-sm font-semibold text-matrix-goldDark shadow-gold">
              {message}
            </div>
          ) : null}
          {plans.map((plan, index) => (
            <PricingCard key={plan.name} billing={billing} index={index + 1} onClick={handlePlanClick} plan={plan} />
          ))}
        </div>
      </section>

      <section className="relative z-10 mx-auto max-w-[1430px] px-4 sm:px-6 lg:px-10">
        <div className="grid gap-3 rounded-2xl border border-matrix-gold/20 bg-white/70 p-4 shadow-[0_18px_70px_rgb(70_50_18/0.12)] backdrop-blur-xl dark:bg-black/35 md:grid-cols-5">
          {benefitStrip.map((benefit) => {
            const Icon = benefit.icon;
            return (
              <div key={benefit.title} className="flex gap-3 border-matrix-border p-3 md:border-r md:last:border-r-0">
                <Icon className="h-7 w-7 shrink-0 text-matrix-goldDark dark:text-matrix-gold" />
                <div>
                  <h3 className="text-sm font-bold text-matrix-fg">{benefit.title}</h3>
                  <p className="mt-1 text-xs leading-5 text-matrix-muted">{benefit.detail}</p>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <ComparisonSection />
      <FaqSection openFaq={openFaq} setOpenFaq={setOpenFaq} />
      <FinalCta onAction={handlePlanClick} />
      <PublicFooter />
    </main>
  );
}

function PublicHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-matrix-border bg-matrix-panel/82 shadow-glow backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-[1580px] items-center justify-between gap-4 px-4 sm:px-6 lg:px-10">
        <Link className="flex items-center gap-3" href="/plans">
          <span className="grid h-10 w-10 place-items-center rounded-lg bg-black text-xl font-bold text-matrix-gold shadow-gold">M</span>
          <span className="text-lg font-bold text-matrix-fg">Matrix Commerce</span>
        </Link>
        <nav className="hidden items-center gap-8 text-sm font-semibold text-matrix-muted md:flex">
          <a href="#recursos" className="hover:text-matrix-goldDark">Recursos</a>
          <a href="#planos" className="border-b-2 border-matrix-gold px-2 py-5 text-matrix-goldDark">Planos</a>
          <a href="#integracoes" className="hover:text-matrix-goldDark">Integracoes</a>
          <a href="#suporte" className="hover:text-matrix-goldDark">Suporte</a>
        </nav>
        <div className="flex items-center gap-2">
          <Link className="rounded-lg border border-matrix-gold/40 px-4 py-2 text-sm font-bold text-matrix-fg hover:bg-matrix-goldSoft/40" href="/login">
            Entrar
          </Link>
          <Link className="rounded-lg bg-matrix-gold px-4 py-2 text-sm font-bold text-black shadow-gold hover:bg-matrix-goldDark hover:text-white" href="/login">
            Comecar agora
          </Link>
        </div>
      </div>
    </header>
  );
}

function PricingCard({ billing, index, onClick, plan }: { billing: BillingCycle; index: number; onClick: (planName: string) => void; plan: (typeof plans)[number] }) {
  const premium = plan.tone === "premium";
  const popular = plan.tone === "popular";

  return (
    <article
      className={cn(
        "relative rounded-2xl border bg-white/74 p-6 shadow-[0_22px_70px_rgb(70_50_18/0.12)] backdrop-blur-xl transition hover:-translate-y-1 dark:bg-black/38",
        popular && "border-matrix-gold/65 ring-1 ring-matrix-gold/25",
        premium ? "border-black bg-[linear-gradient(180deg,rgb(var(--card))_0%,rgb(var(--card-strong))_100%)] shadow-[0_28px_90px_rgb(0_0_0/0.18)] dark:border-matrix-gold/65 dark:bg-black/62" : "border-matrix-border"
      )}
      id={index === 1 ? "planos" : undefined}
    >
      {plan.badge ? <div className="absolute -top-4 left-1/2 -translate-x-1/2 rounded-full bg-matrix-gold px-6 py-1.5 text-xs font-bold uppercase text-black shadow-gold">{plan.badge}</div> : null}
      <div className="flex items-start gap-4">
        <span className={cn("grid h-12 w-12 place-items-center rounded-xl text-xl font-bold", premium ? "bg-black text-matrix-gold shadow-gold" : "bg-matrix-goldSoft/55 text-matrix-goldDark")}>{index}</span>
        <span className={cn("grid h-12 w-12 place-items-center rounded-xl", premium ? "bg-black text-matrix-gold shadow-gold" : "border border-matrix-gold/25 bg-white/65 text-matrix-goldDark dark:bg-black/30")}>
          {premium ? <Gem className="h-6 w-6" /> : popular ? <Sparkles className="h-6 w-6" /> : <PackageCheck className="h-6 w-6" />}
        </span>
        <div>
          <h2 className="text-xl font-bold text-matrix-fg">{plan.name}</h2>
          <p className="mt-1 text-sm text-matrix-muted">{plan.subtitle}</p>
        </div>
      </div>

      <div className="mt-5 grid grid-cols-2 rounded-lg border border-matrix-border bg-matrix-panel/55 p-1 text-center text-xs font-bold">
        <span className={cn("rounded-md py-2", billing === "monthly" && "bg-white text-matrix-goldDark shadow-sm dark:bg-black/40")}>Mensal</span>
        <span className={cn("rounded-md py-2", billing === "yearly" && "bg-white text-matrix-goldDark shadow-sm dark:bg-black/40")}>Anual</span>
      </div>

      <p className="mt-6 text-center text-4xl font-bold text-matrix-fg">{billing === "monthly" ? plan.monthly : plan.yearly}</p>
      {billing === "yearly" ? <p className="mt-2 text-center text-sm font-semibold text-green-700 dark:text-green-300">economize 17%</p> : null}

      <ul className="mt-6 space-y-3">
        {plan.benefits.map((benefit) => (
          <li key={benefit} className="flex items-start gap-2 text-sm text-matrix-muted">
            <Check className="mt-0.5 h-4 w-4 shrink-0 text-matrix-goldDark dark:text-matrix-gold" />
            {benefit}
          </li>
        ))}
      </ul>

      <div className="mt-7 flex items-center gap-3">
        <button
          className={cn("flex-1 rounded-lg px-4 py-3 text-sm font-bold transition", premium ? "bg-black text-matrix-gold shadow-gold hover:bg-matrix-gold hover:text-black" : "bg-matrix-gold text-black shadow-gold hover:bg-matrix-goldDark hover:text-white")}
          onClick={() => onClick(plan.name)}
          type="button"
        >
          {plan.cta}
        </button>
        <button className="whitespace-nowrap text-sm font-bold text-matrix-goldDark hover:text-matrix-gold" onClick={() => onClick(plan.name)} type="button">
          Saiba mais
        </button>
      </div>
    </article>
  );
}

function ComparisonSection() {
  return (
    <section className="mx-auto grid max-w-[1430px] gap-6 px-4 py-12 sm:px-6 lg:grid-cols-[280px_1fr] lg:px-10">
      <div>
        <h2 className="text-3xl font-bold text-matrix-fg">Compare os recursos</h2>
        <p className="mt-3 text-sm leading-6 text-matrix-muted">Escolha o plano que melhor atende as necessidades do seu negocio.</p>
        <div className="mt-8 space-y-3 text-sm text-matrix-muted">
          <p className="flex items-center gap-2"><Check className="h-4 w-4 text-matrix-goldDark" /> Incluido</p>
          <p className="flex items-center gap-2"><span className="h-0.5 w-4 rounded bg-matrix-gold" /> Limitado</p>
          <p className="flex items-center gap-2"><X className="h-4 w-4 text-red-500" /> Nao incluido</p>
        </div>
      </div>
      <div className="matrix-scroll overflow-x-auto rounded-2xl border border-matrix-border bg-white/72 shadow-[0_18px_70px_rgb(70_50_18/0.10)] backdrop-blur-xl dark:bg-black/35">
        <table className="min-w-[820px] w-full text-center text-sm">
          <thead>
            <tr className="border-b border-matrix-border bg-matrix-panel2/70">
              <th className="px-4 py-3 text-left text-matrix-muted">Recurso</th>
              <th className="px-4 py-3 text-matrix-fg">PRO</th>
              <th className="px-4 py-3 text-matrix-fg">PLUS</th>
              <th className="bg-black px-4 py-3 text-matrix-gold">MATRIX</th>
            </tr>
          </thead>
          <tbody>
            {comparisonRows.map((row) => (
              <tr key={row[0]} className="border-b border-matrix-border/70 last:border-b-0">
                <td className="px-4 py-3 text-left font-semibold text-matrix-muted">{row[0]}</td>
                <td className="px-4 py-3 text-matrix-fg">{renderComparisonValue(row[1])}</td>
                <td className="px-4 py-3 text-matrix-fg">{renderComparisonValue(row[2])}</td>
                <td className="bg-matrix-goldSoft/25 px-4 py-3 font-semibold text-matrix-fg">{renderComparisonValue(row[3])}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function renderComparisonValue(value: string) {
  if (value === "included") return <Check className="mx-auto h-5 w-5 text-matrix-goldDark dark:text-matrix-gold" />;
  if (value === "none") return <X className="mx-auto h-5 w-5 text-red-500" />;
  return value;
}

function FaqSection({ openFaq, setOpenFaq }: { openFaq: number; setOpenFaq: (index: number) => void }) {
  return (
    <section className="mx-auto max-w-[1430px] px-4 pb-8 sm:px-6 lg:px-10">
      <h2 className="text-3xl font-bold text-matrix-fg">Perguntas frequentes</h2>
      <div className="mt-5 grid gap-3 md:grid-cols-2">
        {faqItems.map((item, index) => {
          const open = openFaq === index;
          return (
            <article key={item.question} className="rounded-xl border border-matrix-border bg-white/72 p-4 shadow-glow backdrop-blur-xl dark:bg-black/35">
              <button className="flex w-full items-center justify-between gap-3 text-left font-bold text-matrix-fg" onClick={() => setOpenFaq(open ? -1 : index)} type="button">
                {item.question}
                <ChevronDown className={cn("h-5 w-5 text-matrix-goldDark transition", open && "rotate-180")} />
              </button>
              <div className={cn("grid transition-[grid-template-rows,opacity] duration-300", open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0")}>
                <p className="overflow-hidden pt-3 text-sm leading-6 text-matrix-muted">{item.answer}</p>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function FinalCta({ onAction }: { onAction: (planName: string) => void }) {
  return (
    <section className="mx-auto max-w-[1430px] px-4 pb-12 sm:px-6 lg:px-10">
      <div className="relative overflow-hidden rounded-2xl border border-matrix-gold/45 bg-white/72 p-6 shadow-[0_22px_80px_rgb(70_50_18/0.14)] backdrop-blur-xl dark:bg-black/40 md:flex md:items-center md:justify-between md:p-8">
        <div className="login-hero-wave opacity-40" aria-hidden="true" />
        <div className="relative z-10 flex items-center gap-5">
          <span className="grid h-16 w-16 shrink-0 place-items-center rounded-full border border-matrix-gold/40 bg-matrix-goldSoft/40 text-matrix-goldDark">
            <Rocket className="h-8 w-8" />
          </span>
          <div>
            <h2 className="text-3xl font-bold text-matrix-fg">Pronto para transformar sua operacao?</h2>
            <p className="mt-2 text-matrix-muted">Escolha seu plano e comece hoje a levar sua operacao para outro nivel.</p>
          </div>
        </div>
        <div className="relative z-10 mt-6 flex flex-col gap-3 sm:flex-row md:mt-0">
          <Link className="rounded-lg bg-matrix-gold px-7 py-3 text-center font-bold text-black shadow-gold hover:bg-matrix-goldDark hover:text-white" href="/login">
            Comecar agora
          </Link>
          <button className="rounded-lg border border-matrix-gold/40 px-7 py-3 font-bold text-matrix-goldDark hover:bg-matrix-goldSoft/35" onClick={() => onAction("MATRIX")} type="button">
            Falar com especialista
          </button>
        </div>
      </div>
    </section>
  );
}

function PublicFooter() {
  return (
    <footer className="border-t border-matrix-border bg-matrix-panel/70">
      <div className="mx-auto flex max-w-[1580px] flex-col gap-5 px-4 py-6 text-sm text-matrix-muted sm:px-6 lg:flex-row lg:items-center lg:justify-between lg:px-10">
        <Link className="flex items-center gap-3 font-bold text-matrix-fg" href="/plans">
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-black text-matrix-gold shadow-gold">M</span>
          Matrix Commerce
        </Link>
        <nav className="flex flex-wrap gap-x-6 gap-y-2">
          {["Recursos", "Planos", "Integracoes", "Suporte", "Blog", "Quem somos"].map((item) => (
            <a key={item} className="hover:text-matrix-goldDark" href="#">{item}</a>
          ))}
        </nav>
        <p>© 2026 Matrix Commerce. Todos os direitos reservados.</p>
      </div>
    </footer>
  );
}
