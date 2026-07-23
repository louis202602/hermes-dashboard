"use client";

import {
  ArrowUpRight,
  Bot,
  Euro,
  Sun,
  Workflow,
} from "lucide-react";

const cards = [
  {
    title: "Production solaire",
    value: "2,48 MW",
    change: "+18%",
    icon: Sun,
  },
  {
    title: "Agents IA actifs",
    value: "57",
    change: "+4",
    icon: Bot,
  },
  {
    title: "Workflows n8n",
    value: "112",
    change: "+12",
    icon: Workflow,
  },
  {
    title: "CA prévisionnel",
    value: "1,26 M€",
    change: "+24%",
    icon: Euro,
  },
];

export default function KpiGrid() {
  return (
    <section className="kpi-grid">
      {cards.map((card) => {
        const Icon = card.icon;

        return (
          <article className="kpi-card" key={card.title}>
            <div className="kpi-card-top">
              <div className="kpi-icon">
                <Icon size={22} strokeWidth={1.8} />
              </div>

              <div className="kpi-change">
                <ArrowUpRight size={15} />
                {card.change}
              </div>
            </div>

            <span className="kpi-title">
              {card.title}
            </span>

            <strong className="kpi-value">
              {card.value}
            </strong>
          </article>
        );
      })}
    </section>
  );
}
