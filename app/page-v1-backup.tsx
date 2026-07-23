"use client";

import { useEffect, useState } from "react";

const kpis = [
  { label: "Projets en cours", value: "12", trend: "+2 ce mois", tone: "blue" },
  { label: "CA prévisionnel", value: "128 k€", trend: "+18% ce mois", tone: "green" },
  { label: "Devis en attente", value: "5", trend: "-1 ce mois", tone: "orange" },
  { label: "Taux conversion", value: "23%", trend: "+4% ce mois", tone: "purple" },
];

const tasks = [
  ["Relancer Société Martin", "Devis 48 kWc · Envoyé il y a 3 jours", "09:30", "green"],
  ["Valider étude – Projet Fermelec", "Puissance : 49 kWc", "10:15", "orange"],
  ["Appeler prospect Marseille 13011", "Intérêt pour 36 kWc", "11:00", "blue"],
  ["Vérifier commande matériel", "Livraison prévue demain", "14:00", "purple"],
];

const conversations = [
  ["Workflow – Génération automatisée", "Hermès · Aujourd’hui 14:32"],
  ["Optimisation des coûts API", "Hermès · Aujourd’hui 11:08"],
  ["Architecture Dashboard", "Hermès · Hier 16:45"],
  ["Agent 57 – Configuration", "Hermès · Hier 10:22"],
];

const projects = [
  ["Fermelec Marseille", "49 kWc", "Étude", "75%"],
  ["Société Martin", "48 kWc", "Devis", "40%"],
  ["Irisolaris Industrie", "410 kWc", "Signé", "100%"],
  ["Jean Dépôt", "67 kWc", "Devis", "20%"],
  ["Toiture Paluds", "135 kWc", "Étude", "60%"],
];

export default function Home() {
  const [dark, setDark] = useState(true);

  useEffect(() => {
    const saved = localStorage.getItem("hermes-theme");
    if (saved) setDark(saved === "dark");
  }, []);

  function toggleTheme() {
    const next = !dark;
    setDark(next);
    localStorage.setItem("hermes-theme", next ? "dark" : "light");
  }

  return (
    <main className={dark ? "dashboard dark" : "dashboard light"}>
      <div className="space-bg" />

      <aside className="sidebar glass">
        <div className="brand">
          <div className="sun-logo">☀</div>
          <div>
            <strong>HELIOSOLAR</strong>
            <span>OS</span>
          </div>
        </div>

        <nav>
          {["⌂ Accueil", "▣ Projets", "⌘ Workflows", "▤ Documents", "◎ Intelligence", "⚙ Agents", "⚙ Paramètres"].map(
            (item, index) => (
              <button key={item} className={index === 0 ? "nav-active" : ""}>
                {item}
              </button>
            )
          )}
        </nav>

        <div className="sidebar-bottom">
          <div className="mini-card">
            <div className="mini-orb">Σ</div>
            <div>
              <strong>Hermès</strong>
              <span>Directeur IA</span>
              <small>● En ligne</small>
            </div>
          </div>

          <div className="profile">
            <div className="avatar">LP</div>
            <div>
              <strong>Louis Preira</strong>
              <span>Directeur</span>
            </div>
            <b>⌄</b>
          </div>

          <button className="logout">⇥ Déconnexion</button>
        </div>
      </aside>

      <section className="content">
        <header className="topbar">
          <div>
            <h1>Bonjour <span>Louis</span></h1>
            <p>Hermès est prêt à vous assister.</p>
            <small>Que souhaitez-vous accomplir aujourd’hui ?</small>
          </div>

          <div className="weather glass">
            <span>☀</span>
            <b>16°C</b>
            <small>Marseille, France</small>
            <i />
            <small>Mercredi 4 juin 2026<br /><b>09:42</b></small>
          </div>

          <div className="top-actions">
            <button onClick={toggleTheme} className="theme-toggle" aria-label="Changer de thème">
              {dark ? "☀" : "🌙"}
            </button>
            <button>♧</button>
            <button>☆</button>
            <button>?</button>
          </div>
        </header>

        <div className="main-grid">
          <section className="hero">
            <div className="planet" />
            <div className="sunset" />

            <div className="confidence glass">
              <span>Hermès</span>
              <small>Niveau de confiance</small>
              <strong>99,8%</strong>
              <div className="sparkline">⌁⌁╱⌁╱╱</div>
              <em>↗ +1,2% depuis hier</em>
            </div>

            <div className="hermes-orb">
              <div className="orbit orbit-one" />
              <div className="orbit orbit-two" />
              <div className="orb-core">Σ</div>
              <div className="beam" />
            </div>

            <div className="system glass">
              <span>État du système</span>
              <div className="shield">♢</div>
              <strong>Optimal</strong>
              <small>Tous les systèmes<br />sont opérationnels</small>
              <em>● 24 agents actifs</em>
            </div>

            <div className="command glass">
              <span>⌕</span>
              <input placeholder="Que souhaitez-vous accomplir aujourd’hui ?" />
              <button>➤</button>
            </div>

            <div className="shortcuts">
              {[
                ["▧", "Créer un workflow n8n", "Agent 57"],
                ["▤", "Analyser un projet", "Bureau d’études"],
                ["◎", "Optimiser mes coûts", "Intelligence"],
                ["◇", "Générer un devis", "Hermès"],
                ["⌘", "Autre demande", "Hermès"],
              ].map(([icon, title, meta]) => (
                <button className="shortcut glass" key={title}>
                  <span>{icon}</span>
                  <b>→</b>
                  <strong>{title}</strong>
                  <small>{meta}</small>
                </button>
              ))}
            </div>

            <div className="tagline">☀ <b>L’énergie solaire.</b> L’intelligence artificielle. Un avenir durable.</div>
          </section>

          <aside className="right-column">
            <div className="panel glass">
              <div className="panel-title">
                <strong>⌁ Indicateurs clés</strong>
                <a>Voir tout</a>
              </div>
              <div className="kpi-grid">
                {kpis.map((kpi) => (
                  <div className={`kpi ${kpi.tone}`} key={kpi.label}>
                    <small>{kpi.label}</small>
                    <strong>{kpi.value}</strong>
                    <div className="mini-chart">╱╲╱╱╲╱</div>
                    <em>{kpi.trend}</em>
                  </div>
                ))}
              </div>
            </div>

            <div className="panel glass">
              <div className="panel-title">
                <strong>☑ Tâches prioritaires</strong>
                <a>Voir tout</a>
              </div>
              <div className="list">
                {tasks.map(([title, subtitle, time, tone]) => (
                  <div className="list-row" key={title}>
                    <span className={`list-icon ${tone}`}>▣</span>
                    <div>
                      <strong>{title}</strong>
                      <small>{subtitle}</small>
                    </div>
                    <time>{time}</time>
                  </div>
                ))}
              </div>
            </div>

            <div className="panel glass">
              <div className="panel-title">
                <strong>▣ Conversations récentes</strong>
                <a>Voir tout</a>
              </div>
              <div className="list">
                {conversations.map(([title, subtitle]) => (
                  <div className="list-row conversation" key={title}>
                    <span className="list-icon blue">◎</span>
                    <div>
                      <strong>{title}</strong>
                      <small>{subtitle}</small>
                    </div>
                    <b>›</b>
                  </div>
                ))}
              </div>
            </div>
          </aside>
        </div>

        <section className="bottom-grid">
          <div className="panel glass">
            <div className="panel-title">
              <strong>▣ Projets récents</strong>
              <button>＋ Nouveau projet</button>
            </div>
            <div className="project-table">
              {projects.map(([name, power, status, progress]) => (
                <div className="project-row" key={name}>
                  <span>▧</span>
                  <strong>{name}</strong>
                  <small>{power}</small>
                  <em>{status}</em>
                  <div className="progress"><i style={{ width: progress }} /></div>
                  <small>{progress}</small>
                </div>
              ))}
            </div>
          </div>

          <div className="panel glass workflow">
            <div className="panel-title">
              <strong>← Workflow en cours</strong>
              <a>Voir détails</a>
            </div>
            <small>Génération automatisée</small>
            <div className="workflow-line">
              <div>◉<span>Déclencheur<br />Webhook</span></div>
              <b>···</b>
              <div>⌘<span>Analyse<br />OpenAI</span></div>
              <b>···</b>
              <div>▤<span>Données<br />Notion</span></div>
              <b>···</b>
              <div>✉<span>Envoi<br />Gmail</span></div>
            </div>
            <div className="workflow-stats">
              <span><small>Statut</small><b>● Actif</b></span>
              <span><small>Dernière exécution</small><b>Aujourd’hui 14:32</b></span>
              <span><small>Exécutions</small><b>128</b></span>
              <span><small>Taux de succès</small><b>98,4%</b></span>
            </div>
          </div>

          <div className="panel glass system-view">
            <div className="panel-title">
              <strong>⌁ Vue système</strong>
              <a>Voir détails</a>
            </div>
            <div className="system-body">
              <div className="ring"><span>24%</span><small>Moyenne</small></div>
              <div className="meters">
                {[
                  ["CPU", "24%"],
                  ["Mémoire", "48%"],
                  ["Agents actifs", "24 / 58"],
                  ["Stockage", "62%"],
                ].map(([label, value], index) => (
                  <div key={label}>
                    <span>{label}</span>
                    <i><b style={{ width: `${24 + index * 13}%` }} /></i>
                    <small>{value}</small>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>
      </section>
    </main>
  );
}
