"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  BarChart3,
  Bot,
  Check,
  ChevronLeft,
  ChevronRight,
  Eye,
  EyeOff,
  Gem,
  Headphones,
  LockKeyhole,
  Mail,
  PackageCheck,
  Rocket,
  ShieldCheck,
  ShoppingCart,
  Sparkles,
  TrendingUp,
  Workflow
} from "lucide-react";
import { Button } from "@/components/ui";

const heroCards = [
  { label: "Pedidos importados hoje", value: "86", hint: "3 canais", icon: ShoppingCart },
  { label: "Faturamento acumulado", value: "R$ 624.101,00", hint: "+18,6% vs ontem", icon: TrendingUp },
  { label: "Produtos sincronizados", value: "1.248", hint: "+38 hoje", icon: PackageCheck },
  { label: "Automacoes ativas", value: "432", hint: "Ultimas 24h", icon: Workflow }
];

const featureCards = [
  { title: "Sincronizacao em tempo real", detail: "Dados sempre atualizados em todos os canais.", icon: Rocket },
  { title: "Automacao inteligente", detail: "Fluxos que trabalham por voce, 24/7.", icon: Bot },
  { title: "Integracoes avancadas", detail: "Conecte ERP, marketplaces e plataformas.", icon: Workflow },
  { title: "Insights que geram valor", detail: "Metricas para decisoes mais assertivas.", icon: BarChart3 }
];

const plans = [
  {
    name: "PRO",
    subtitle: "Essencial para comecar com eficiencia",
    price: "R$ 129/mes",
    annual: "R$ 1.290/ano (economize 17%)",
    benefits: ["Gestao de produtos e pedidos", "Integracao com Marketplaces", "Relatorios basicos", "+2 beneficios"],
    cta: "Assinar Pro"
  },
  {
    name: "PLUS",
    subtitle: "Mais automacoes e integracoes",
    price: "R$ 279/mes",
    annual: "R$ 2.790/ano (economize 17%)",
    benefits: ["Tudo do plano PRO", "Automacoes ilimitadas", "Relatorios avancados", "+3 beneficios"],
    cta: "Assinar Plus"
  },
  {
    name: "MATRIX",
    subtitle: "Maximo desempenho e inteligencia",
    price: "R$ 599/mes",
    annual: "R$ 5.990/ano (economize 17%)",
    benefits: ["Tudo do plano PLUS", "IA avancada e previsoes", "Suporte prioritario 24/7", "+3 beneficios"],
    cta: "Assinar Matrix",
    featured: true
  }
];

export function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("Crowner@admin.com");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(true);
  const [plansOpen, setPlansOpen] = useState(false);
  const [planMessage, setPlanMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!plansOpen) return;

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setPlansOpen(false);
    }

    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [plansOpen]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setLoading(true);

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password })
      });

      if (!response.ok) {
        setError("E-mail ou senha invalidos.");
        return;
      }

      router.push("/");
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  function showCheckoutSoon(planName: string) {
    setPlanMessage(`Checkout do plano ${planName} em breve.`);
  }

  return (
    <main className="login-premium-shell min-h-[100dvh] bg-matrix-bg text-matrix-fg lg:overflow-hidden">
      <div className="login-gold-lines" aria-hidden="true" />
      <div
        className={`relative mx-auto flex min-h-[100dvh] w-full flex-col px-4 py-4 sm:px-6 ${
          plansOpen ? "max-w-[1920px] lg:px-4 2xl:px-6" : "max-w-[1760px] lg:px-8"
        }`}
      >
        <div
          className={`grid min-h-0 flex-1 items-center gap-8 py-4 ${
            plansOpen
              ? "xl:grid-cols-[minmax(0,840px)] xl:justify-center min-[1600px]:grid-cols-[minmax(0,840px)_minmax(680px,1fr)] min-[1600px]:justify-stretch min-[1600px]:gap-4 min-[1728px]:grid-cols-[minmax(0,840px)_minmax(760px,1fr)] min-[1728px]:gap-6 min-[1900px]:grid-cols-[minmax(0,840px)_minmax(900px,1fr)]"
              : "xl:grid-cols-[minmax(420px,auto)_minmax(0,1fr)] xl:gap-12"
          }`}
        >
          <div className="relative mx-auto flex w-full max-w-[880px] items-center justify-center gap-0 lg:justify-start">
            <section className="login-card-motion relative z-20 w-full max-w-[500px] rounded-[1.25rem] border border-matrix-gold/45 bg-white/84 p-6 shadow-[0_24px_80px_rgb(70_50_18/0.15)] backdrop-blur-2xl dark:bg-black/58 sm:p-8 xl:p-9">
              <button
                aria-controls="login-plans-panel"
                aria-expanded={plansOpen}
                aria-label={plansOpen ? "Fechar planos" : "Abrir planos"}
                className="absolute right-[-1.2rem] top-1/2 z-40 hidden h-14 w-10 -translate-y-1/2 place-items-center rounded-full border border-matrix-gold/45 bg-white/90 text-matrix-goldDark shadow-gold transition hover:bg-matrix-gold hover:text-black dark:bg-black/80 dark:text-matrix-gold md:grid"
                onClick={() => setPlansOpen((current) => !current)}
                type="button"
              >
                {plansOpen ? <ChevronLeft className="h-5 w-5" /> : <ChevronRight className="h-5 w-5" />}
              </button>

              <div className="flex items-center gap-4">
                <div className="grid h-14 w-14 shrink-0 place-items-center rounded-xl bg-black text-2xl font-bold text-matrix-gold shadow-gold">
                  M
                </div>
                <div>
                  <p className="text-sm font-medium text-matrix-muted">SaaS Hub</p>
                  <h1 className="text-xl font-bold tracking-normal text-matrix-fg">Matrix Commerce</h1>
                </div>
              </div>

              <div className="mt-6">
                <h2 className="text-3xl font-bold tracking-normal text-matrix-fg">Bem-vindo de volta</h2>
                <p className="mt-3 max-w-md text-sm leading-6 text-matrix-muted">
                  Acesse sua central de operacoes e impulsione seus resultados com inteligencia e automacao.
                </p>
              </div>

              <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
                <label className="grid gap-2 text-sm font-semibold text-matrix-fg">
                  E-mail
                  <span className="flex h-12 items-center gap-3 rounded-lg border border-matrix-border bg-white/72 px-4 shadow-inner dark:bg-matrix-panel2/80">
                    <Mail className="h-4 w-4 text-matrix-muted" />
                    <input
                      autoComplete="email"
                      className="w-full bg-transparent text-sm text-matrix-fg outline-none placeholder:text-matrix-muted"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      placeholder="seu@email.com"
                      type="email"
                    />
                  </span>
                </label>

                <label className="grid gap-2 text-sm font-semibold text-matrix-fg">
                  Senha
                  <span className="flex h-12 items-center gap-3 rounded-lg border border-matrix-border bg-white/72 px-4 shadow-inner dark:bg-matrix-panel2/80">
                    <LockKeyhole className="h-4 w-4 text-matrix-muted" />
                    <input
                      autoComplete="current-password"
                      className="w-full bg-transparent text-sm text-matrix-fg outline-none placeholder:text-matrix-muted"
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      placeholder="Digite sua senha"
                      type={showPassword ? "text" : "password"}
                    />
                    <button
                      aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
                      className="grid h-8 w-8 place-items-center rounded-md text-matrix-muted hover:bg-matrix-goldSoft/50 hover:text-matrix-goldDark"
                      onClick={() => setShowPassword((current) => !current)}
                      type="button"
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </span>
                </label>

                <div className="flex items-center justify-between gap-3 text-sm">
                  <label className="flex cursor-pointer items-center gap-2 text-matrix-muted">
                    <span className="grid h-5 w-5 place-items-center rounded border border-matrix-gold/45 bg-matrix-gold text-black">
                      {remember ? <Check className="h-3.5 w-3.5" /> : null}
                    </span>
                    <input className="sr-only" checked={remember} onChange={(event) => setRemember(event.target.checked)} type="checkbox" />
                    Lembrar-me
                  </label>
                  <a className="font-medium text-matrix-goldDark hover:text-matrix-gold" href="#" onClick={(event) => event.preventDefault()}>
                    Esqueci minha senha
                  </a>
                </div>

                {error ? <p className="rounded-md border border-red-500/25 bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-200">{error}</p> : null}

                <Button className="h-13 w-full rounded-lg text-base" disabled={loading} type="submit">
                  <Rocket className="h-5 w-5" />
                  {loading ? "Entrando..." : "Entrar"}
                </Button>

                <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-4 text-sm text-matrix-muted">
                  <span className="h-px bg-matrix-border" />
                  ou
                  <span className="h-px bg-matrix-border" />
                </div>

                <button
                  className="flex h-12 w-full cursor-not-allowed items-center justify-center gap-3 rounded-lg border border-matrix-border bg-white/62 text-sm font-semibold text-matrix-muted opacity-75 dark:bg-matrix-panel2/70"
                  disabled
                  type="button"
                  title="Google em breve"
                >
                  <span className="text-lg font-bold text-[#4285f4]">G</span>
                  Entrar com Google
                  <span className="rounded-full bg-matrix-goldSoft px-2 py-0.5 text-xs text-matrix-goldDark">em breve</span>
                </button>
              </form>

              <button
                aria-controls="login-plans-panel"
                aria-expanded={plansOpen}
                className="mt-5 flex w-full items-center justify-center gap-2 rounded-lg border border-matrix-gold/35 bg-matrix-goldSoft/35 px-4 py-3 text-sm font-semibold text-matrix-goldDark md:hidden"
                onClick={() => setPlansOpen(true)}
                type="button"
              >
                Ver planos
                <ChevronRight className="h-4 w-4" />
              </button>

              <p className="mt-5 flex items-center justify-center gap-2 text-center text-sm text-matrix-muted">
                <LockKeyhole className="h-4 w-4 text-matrix-gold" />
                Acesse com seguranca sua central de operacoes.
              </p>
            </section>

            <PlansPanel
              id="login-plans-panel"
              message={planMessage}
              onChoosePlan={showCheckoutSoon}
              open={plansOpen}
            />
          </div>

          <section
            className={`relative h-[640px] min-h-0 overflow-hidden rounded-[1.5rem] border border-matrix-gold/20 bg-white/44 p-8 shadow-[0_24px_90px_rgb(70_50_18/0.12)] backdrop-blur-xl dark:bg-white/[0.045] 2xl:p-10 ${
              plansOpen ? "hidden min-[1600px]:block" : "hidden xl:block"
            }`}
          >
            <div className="login-hero-wave" aria-hidden="true" />
            <div className={`relative z-10 flex h-full min-h-0 flex-col gap-6 ${plansOpen ? "justify-start min-[1800px]:justify-between" : "justify-between"}`}>
              <div
                className={`grid min-h-0 gap-5 ${
                  plansOpen
                    ? "min-[1800px]:grid-cols-[minmax(0,0.95fr)_minmax(360px,0.85fr)] min-[1800px]:items-start 2xl:gap-8"
                    : "xl:grid-cols-[minmax(0,0.95fr)_minmax(360px,0.85fr)] xl:items-start 2xl:gap-8"
                }`}
              >
                <div className={plansOpen ? "max-w-[560px] pt-2 min-[1800px]:pt-8" : "max-w-[520px] pt-4 xl:pt-8 2xl:pt-12"}>
                  <Sparkles className="mb-5 h-10 w-10 text-matrix-gold" />
                  <h2 className={`font-bold leading-tight tracking-normal text-matrix-fg ${plansOpen ? "text-4xl min-[1800px]:text-[2.85rem] min-[1900px]:text-5xl" : "text-4xl xl:text-[2.85rem] 2xl:text-5xl"}`}>
                    Automacao que conecta.
                    <br />
                    Dados que <span className="text-matrix-goldDark dark:text-matrix-gold">transformam</span>.
                  </h2>
                  <p className="mt-5 max-w-md text-base leading-7 text-matrix-muted xl:text-lg xl:leading-8">
                    Gestao inteligente de produtos, pedidos, integracoes e performance em um so lugar.
                  </p>
                </div>

                <div className="grid min-w-0 grid-cols-2 gap-3 xl:pt-2 2xl:gap-4">
                  {heroCards.map((card, index) => {
                    const Icon = card.icon;
                    return (
                      <div
                        key={card.label}
                        className="login-float-card min-w-0 rounded-xl border border-matrix-gold/25 bg-white/88 p-3 shadow-[0_16px_55px_rgb(70_50_18/0.12)] backdrop-blur-md dark:bg-zinc-950/82 2xl:p-4"
                        style={{ animationDelay: `${180 + index * 120}ms` }}
                      >
                        <div className="flex min-w-0 items-start gap-3 2xl:gap-4">
                          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-matrix-goldSoft/70 text-matrix-goldDark">
                            <Icon className="h-5 w-5" />
                          </div>
                          <div className="min-w-0">
                            <p className="text-xs font-semibold leading-5 text-matrix-fg 2xl:text-sm">{card.label}</p>
                            <p className="mt-1 text-xl font-bold leading-tight text-matrix-fg 2xl:text-2xl">{card.value}</p>
                            <p className="mt-1 text-xs leading-5 text-matrix-muted 2xl:text-sm">{card.hint}</p>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div
                className={`grid-cols-2 gap-3 rounded-2xl border border-matrix-gold/20 bg-white/82 p-3 shadow-[0_14px_50px_rgb(70_50_18/0.10)] backdrop-blur-md dark:bg-zinc-950/76 2xl:grid-cols-4 2xl:p-4 ${
                  plansOpen ? "hidden min-[1800px]:grid" : "grid"
                }`}
              >
                {featureCards.map((feature) => {
                  const Icon = feature.icon;
                  return (
                    <div key={feature.title} className="min-w-0 rounded-xl border border-matrix-border/70 bg-white/44 p-3 dark:bg-white/[0.03] 2xl:border-0 2xl:bg-transparent 2xl:px-4">
                      <Icon className="h-5 w-5 text-matrix-goldDark dark:text-matrix-gold 2xl:h-6 2xl:w-6" />
                      <p className="mt-2 text-xs font-semibold leading-5 text-matrix-fg 2xl:text-sm">{feature.title}</p>
                      <p className="mt-1 text-[11px] leading-4 text-matrix-muted 2xl:text-xs 2xl:leading-5">{feature.detail}</p>
                    </div>
                  );
                })}
              </div>
            </div>
          </section>
        </div>

        {plansOpen ? (
          <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm md:hidden" onClick={() => setPlansOpen(false)}>
            <div className="absolute inset-x-0 bottom-0 max-h-[86vh] overflow-y-auto rounded-t-3xl border border-matrix-gold/30 bg-matrix-panel p-4 shadow-[0_-20px_70px_rgb(70_50_18/0.2)]" onClick={(event) => event.stopPropagation()}>
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-matrix-goldDark">Planos</p>
                  <h3 className="text-xl font-bold text-matrix-fg">Escolha seu plano</h3>
                </div>
                <button className="grid h-10 w-10 place-items-center rounded-full border border-matrix-border text-matrix-muted" onClick={() => setPlansOpen(false)} type="button">
                  <ChevronRight className="h-5 w-5 rotate-90" />
                </button>
              </div>
              <PlansList message={planMessage} onChoosePlan={showCheckoutSoon} />
            </div>
          </div>
        ) : null}

        <footer className="relative z-20 grid gap-4 border-t border-matrix-border/70 py-3 text-xs text-matrix-muted lg:grid-cols-[1fr_auto] lg:items-center">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <span className="flex items-center gap-2 font-semibold text-matrix-fg">
              <span className="grid h-8 w-8 place-items-center rounded-md bg-black text-matrix-gold">M</span>
              Matrix Commerce
            </span>
            <span>© 2026 Todos os direitos reservados.</span>
            <span className="flex items-center gap-1"><ShieldCheck className="h-3.5 w-3.5" /> Seguranca de nivel empresarial</span>
            <span>Conformidade LGPD</span>
            <span>Infraestrutura 99,9% uptime</span>
          </div>
          <div className="flex items-center gap-3 lg:justify-end">
            <span>Precisa de ajuda?</span>
            <a className="flex items-center gap-2 font-semibold text-matrix-goldDark hover:text-matrix-gold" href="#" onClick={(event) => event.preventDefault()}>
              <Headphones className="h-4 w-4" />
              Suporte
            </a>
          </div>
        </footer>
      </div>
    </main>
  );
}

function PlansPanel({ id, message, onChoosePlan, open }: { id: string; message: string; onChoosePlan: (planName: string) => void; open: boolean }) {
  return (
    <aside
      aria-hidden={!open}
      className={`login-plans-panel hidden md:block ${open ? "login-plans-panel-open" : ""}`}
      id={id}
    >
      <div className="max-h-[78dvh] overflow-y-auto rounded-r-[1.35rem] border border-l-0 border-matrix-gold/30 bg-white/82 p-4 shadow-[22px_24px_70px_rgb(70_50_18/0.13)] backdrop-blur-2xl dark:bg-zinc-950/82">
        <div className="mb-3">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-matrix-goldDark">Planos</p>
          <h3 className="text-xl font-bold text-matrix-fg">Escolha seu plano</h3>
        </div>
        <PlansList message={message} onChoosePlan={onChoosePlan} />
      </div>
    </aside>
  );
}

function PlansList({ message, onChoosePlan }: { message: string; onChoosePlan: (planName: string) => void }) {
  return (
    <div className="space-y-3">
      {message ? <p className="rounded-lg border border-matrix-gold/30 bg-matrix-goldSoft/45 px-3 py-2 text-sm font-medium text-matrix-goldDark">{message}</p> : null}
      {plans.map((plan) => (
        <article
          key={plan.name}
          className={`rounded-xl border bg-white/72 p-4 shadow-[0_14px_40px_rgb(70_50_18/0.08)] dark:bg-matrix-panel2/76 ${
            plan.featured ? "border-matrix-gold/70 ring-1 ring-matrix-gold/30" : "border-matrix-border"
          }`}
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <h4 className="text-lg font-bold text-matrix-fg">{plan.name}</h4>
                {plan.featured ? <Gem className="h-4 w-4 text-matrix-gold" /> : null}
              </div>
              <p className="mt-1 text-xs leading-5 text-matrix-muted">{plan.subtitle}</p>
            </div>
            {plan.featured ? <span className="rounded-full bg-matrix-gold px-2 py-1 text-xs font-bold text-black">destaque</span> : null}
          </div>
          <p className="mt-3 text-2xl font-bold text-matrix-fg">{plan.price}</p>
          <p className="mt-1 text-xs font-medium text-matrix-goldDark">{plan.annual}</p>
          <ul className="mt-3 space-y-2">
            {plan.benefits.map((benefit) => (
              <li key={benefit} className="flex items-start gap-2 text-xs text-matrix-muted">
                <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-matrix-goldDark" />
                {benefit}
              </li>
            ))}
          </ul>
          <div className="mt-4 flex items-center gap-2">
            <button
              className={`flex-1 rounded-lg px-3 py-2 text-sm font-bold transition ${
                plan.featured
                  ? "bg-matrix-gold text-black shadow-gold hover:bg-matrix-goldDark hover:text-white"
                  : "border border-matrix-gold/35 bg-matrix-goldSoft/35 text-matrix-goldDark hover:bg-matrix-gold hover:text-black"
              }`}
              onClick={() => onChoosePlan(plan.name)}
              type="button"
            >
              {plan.cta}
            </button>
            <button className="px-2 py-2 text-xs font-semibold text-matrix-goldDark hover:text-matrix-gold" onClick={() => onChoosePlan(plan.name)} type="button">
              Saiba mais
            </button>
          </div>
        </article>
      ))}
    </div>
  );
}
