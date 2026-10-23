/**
 * Lógica Analítica e Interactiva del Dashboard 911 - Condado de Montgomery, PA
 * Creado con Observable Plot (v0.6) y D3 (v7)
 * Maestría en Inteligencia Artificial - Visualización de Datos
 * Estudiante: Ali Michelle Nava Alfaro | Docente: Ricardo Emmanuel Reyes Acosta
 */

(function () {
  'use strict';

  // 1. Estado Reactivo del Dashboard
  const state = {
    selectedCategory: 'ALL',       // 'ALL' | 'EMS' | 'Traffic' | 'Fire'
    activeTimePreset: '24h',       // '24h' | 'morning' | 'plateau' | 'evening' | 'night'
    zoomRange: [0, 23],            // [minHour, maxHour]
    isNightFocus: false,           // Foco en valle nocturno continuo (20h a 06h)
    
    // Estados de Zoom individual por cada gráfico
    univariateZoom: 'normal',      // 'normal' (0-360k) | 'focus' (50k-350k)
    bivariateZoomLevel: 0,         // Nivel de zoom continuo (0=24h, 1=16h, 2=8h)
    heatmapZoom: 'full',           // 'full' (0-23h) | 'peak' (7-19h)
    geoZoom: 'county',             // 'county' | 'core' | 'periphery'
    boxplotZoom: 'focus',          // 'focus' (0-320 para ver cajas con amplitud) | 'full' (0-1300 con outliers)

    activeModel: 'dynamic',        // 'dynamic' (ACO / MADR) | 'static' (Status Quo)
    theme: 'dark'
  };

  const data = window.MONTGOMERY_911_DATA;

  // 2. Elementos del DOM
  const dom = {
    themeToggleBtn: document.getElementById('theme-toggle-btn'),
    themeIcon: document.getElementById('theme-icon'),
    themeLabel: document.getElementById('theme-label'),
    resetBtn: document.getElementById('reset-filters-btn'),
    categoryPills: document.querySelectorAll('.pill-btn'),
    timeChips: document.querySelectorAll('.time-chip'),
    modelBtns: document.querySelectorAll('.model-btn'),
    
    // Contenedores de Gráficos Observable Plot
    plotUnivariate: document.getElementById('plot-univariate'),
    plotBivariate: document.getElementById('plot-bivariate'),
    plotMultivariate: document.getElementById('plot-multivariate'),
    plotGeo: document.getElementById('plot-geo'),
    plotUncertainty: document.getElementById('plot-uncertainty'),

    // Botones de Zoom individuales por tarjeta
    btnZoomUniNormal: document.getElementById('btn-zoom-uni-normal'),
    btnZoomUniFocus: document.getElementById('btn-zoom-uni-focus'),
    btnZoomBivIn: document.getElementById('btn-zoom-biv-in'),
    btnZoomBivOut: document.getElementById('btn-zoom-biv-out'),
    btnZoomBivReset: document.getElementById('btn-zoom-biv-reset'),
    btnZoomHeatFull: document.getElementById('btn-zoom-heat-full'),
    btnZoomHeatPeak: document.getElementById('btn-zoom-heat-peak'),
    btnZoomGeoCore: document.getElementById('btn-zoom-geo-core'),
    btnZoomGeoPeriphery: document.getElementById('btn-zoom-geo-periphery'),
    btnZoomGeoReset: document.getElementById('btn-zoom-geo-reset'),
    btnZoomBoxFocus: document.getElementById('btn-zoom-box-focus'),
    btnZoomBoxFull: document.getElementById('btn-zoom-box-full')
  };

  /**
   * Inicialización del Dashboard
   */
  function init() {
    if (!data) {
      console.error("No se encontró el dataset MONTGOMERY_911_DATA.");
      return;
    }
    setupEventListeners();
    renderAllPlots();
    window.addEventListener('resize', debounce(renderAllPlots, 180));
  }

  /**
   * Configuración de Listeners Interactivos
   */
  function setupEventListeners() {
    // 1. Filtro por Macrocategoría (Aislar EMS, Traffic, Fire o Todas)
    dom.categoryPills.forEach(pill => {
      pill.addEventListener('click', () => {
        const cat = pill.dataset.category;
        state.selectedCategory = cat;
        dom.categoryPills.forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
        renderAllPlots();
      });
    });

    // 2. Filtro de Franjas Horarias Críticas
    dom.timeChips.forEach(chip => {
      chip.addEventListener('click', () => {
        const preset = chip.dataset.preset;
        state.activeTimePreset = preset;
        dom.timeChips.forEach(c => c.classList.remove('active'));
        chip.classList.add('active');

        state.isNightFocus = (preset === 'night');

        switch (preset) {
          case 'morning':
            state.zoomRange = [6, 12];   // Pico bimodal matutino de tráfico (08:00–09:00h)
            break;
          case 'plateau':
            state.zoomRange = [9, 17];   // Meseta diurna sostenida de EMS (10:00–16:00h)
            break;
          case 'evening':
            state.zoomRange = [14, 21];  // Pico bimodal vespertino de tráfico (16:00–18:00h)
            break;
          case 'night':
            state.zoomRange = [0, 23];   // Ciclo completo con sombreado nocturno continuo (20h a 06h)
            break;
          case '24h':
          default:
            state.zoomRange = [0, 23];
            break;
        }

        renderBivariatePlot();
        renderGeoPlot();
      });
    });

    // 3. Switch de Simulación de Despacho (Reactivo vs Deliberativo ACO)
    dom.modelBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const model = btn.dataset.model;
        state.activeModel = model;
        dom.modelBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        renderGeoPlot();
      });
    });

    // 4. Controles de Zoom Individuales:
    // Univariada
    if (dom.btnZoomUniNormal && dom.btnZoomUniFocus) {
      dom.btnZoomUniNormal.addEventListener('click', () => {
        state.univariateZoom = 'normal';
        dom.btnZoomUniNormal.classList.add('active');
        dom.btnZoomUniFocus.classList.remove('active');
        renderUnivariatePlot();
      });
      dom.btnZoomUniFocus.addEventListener('click', () => {
        state.univariateZoom = 'focus';
        dom.btnZoomUniFocus.classList.add('active');
        dom.btnZoomUniNormal.classList.remove('active');
        renderUnivariatePlot();
      });
    }

    // Bivariada (Zoom In / Out / Reset)
    if (dom.btnZoomBivIn && dom.btnZoomBivOut && dom.btnZoomBivReset) {
      dom.btnZoomBivIn.addEventListener('click', () => {
        // Reducir rango horario centrado
        const mid = (state.zoomRange[0] + state.zoomRange[1]) / 2;
        const currentSpan = state.zoomRange[1] - state.zoomRange[0];
        const newSpan = Math.max(5, Math.floor(currentSpan * 0.7));
        const newMin = Math.max(0, Math.floor(mid - newSpan / 2));
        const newMax = Math.min(23, newMin + newSpan);
        state.zoomRange = [newMin, newMax];
        renderBivariatePlot();
      });
      dom.btnZoomBivOut.addEventListener('click', () => {
        const mid = (state.zoomRange[0] + state.zoomRange[1]) / 2;
        const currentSpan = state.zoomRange[1] - state.zoomRange[0];
        const newSpan = Math.min(23, Math.ceil(currentSpan * 1.4));
        const newMin = Math.max(0, Math.floor(mid - newSpan / 2));
        const newMax = Math.min(23, newMin + newSpan);
        state.zoomRange = [newMin, newMax];
        renderBivariatePlot();
      });
      dom.btnZoomBivReset.addEventListener('click', () => {
        state.zoomRange = [0, 23];
        state.isNightFocus = false;
        dom.timeChips.forEach(c => c.classList.toggle('active', c.dataset.preset === '24h'));
        renderBivariatePlot();
      });
    }

    // Heatmap (Vista 24h vs Horas Pico 07-19h)
    if (dom.btnZoomHeatFull && dom.btnZoomHeatPeak) {
      dom.btnZoomHeatFull.addEventListener('click', () => {
        state.heatmapZoom = 'full';
        dom.btnZoomHeatFull.classList.add('active');
        dom.btnZoomHeatPeak.classList.remove('active');
        renderMultivariatePlot();
      });
      dom.btnZoomHeatPeak.addEventListener('click', () => {
        state.heatmapZoom = 'peak';
        dom.btnZoomHeatPeak.classList.add('active');
        dom.btnZoomHeatFull.classList.remove('active');
        renderMultivariatePlot();
      });
    }

    // Geoespacial (Condado vs Núcleo vs Periferia)
    if (dom.btnZoomGeoCore && dom.btnZoomGeoPeriphery && dom.btnZoomGeoReset) {
      dom.btnZoomGeoCore.addEventListener('click', () => {
        state.geoZoom = 'core';
        dom.btnZoomGeoCore.classList.add('active');
        dom.btnZoomGeoPeriphery.classList.remove('active');
        dom.btnZoomGeoReset.classList.remove('active');
        renderGeoPlot();
      });
      dom.btnZoomGeoPeriphery.addEventListener('click', () => {
        state.geoZoom = 'periphery';
        dom.btnZoomGeoPeriphery.classList.add('active');
        dom.btnZoomGeoCore.classList.remove('active');
        dom.btnZoomGeoReset.classList.remove('active');
        renderGeoPlot();
      });
      dom.btnZoomGeoReset.addEventListener('click', () => {
        state.geoZoom = 'county';
        dom.btnZoomGeoReset.classList.add('active');
        dom.btnZoomGeoCore.classList.remove('active');
        dom.btnZoomGeoPeriphery.classList.remove('active');
        renderGeoPlot();
      });
    }

    // Boxplot (Escala Focalizada 0-320 vs Completa 0-1300)
    if (dom.btnZoomBoxFocus && dom.btnZoomBoxFull) {
      dom.btnZoomBoxFocus.addEventListener('click', () => {
        state.boxplotZoom = 'focus';
        dom.btnZoomBoxFocus.classList.add('active');
        dom.btnZoomBoxFull.classList.remove('active');
        renderUncertaintyPlot();
      });
      dom.btnZoomBoxFull.addEventListener('click', () => {
        state.boxplotZoom = 'full';
        dom.btnZoomBoxFull.classList.add('active');
        dom.btnZoomBoxFocus.classList.remove('active');
        renderUncertaintyPlot();
      });
    }

    // 5. Alternador de Tema Claro / Oscuro
    if (dom.themeToggleBtn) {
      dom.themeToggleBtn.addEventListener('click', () => {
        state.theme = state.theme === 'dark' ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', state.theme);
        if (dom.themeIcon) dom.themeIcon.textContent = state.theme === 'dark' ? '☀️' : '🌙';
        if (dom.themeLabel) dom.themeLabel.textContent = state.theme === 'dark' ? 'Modo Claro' : 'Modo Oscuro';
        renderAllPlots();
      });
    }

    // 6. Botón de Restablecer Todo
    if (dom.resetBtn) {
      dom.resetBtn.addEventListener('click', () => {
        state.selectedCategory = 'ALL';
        state.activeTimePreset = '24h';
        state.zoomRange = [0, 23];
        state.isNightFocus = false;
        state.univariateZoom = 'normal';
        state.heatmapZoom = 'full';
        state.geoZoom = 'county';
        state.boxplotZoom = 'focus';
        state.activeModel = 'dynamic';

        dom.categoryPills.forEach(p => p.classList.toggle('active', p.dataset.category === 'ALL'));
        dom.timeChips.forEach(c => c.classList.toggle('active', c.dataset.preset === '24h'));
        dom.modelBtns.forEach(b => b.classList.toggle('active', b.dataset.model === 'dynamic'));

        if (dom.btnZoomUniNormal) dom.btnZoomUniNormal.classList.add('active');
        if (dom.btnZoomUniFocus) dom.btnZoomUniFocus.classList.remove('active');
        if (dom.btnZoomHeatFull) dom.btnZoomHeatFull.classList.add('active');
        if (dom.btnZoomHeatPeak) dom.btnZoomHeatPeak.classList.remove('active');
        if (dom.btnZoomGeoReset) dom.btnZoomGeoReset.classList.add('active');
        if (dom.btnZoomBoxFocus) dom.btnZoomBoxFocus.classList.add('active');
        if (dom.btnZoomBoxFull) dom.btnZoomBoxFull.classList.remove('active');

        renderAllPlots();
      });
    }
  }

  /**
   * Renderizar todos los gráficos de Observable Plot
   */
  function renderAllPlots() {
    renderUnivariatePlot();
    renderBivariatePlot();
    renderMultivariatePlot();
    renderGeoPlot();
    renderUncertaintyPlot();
  }

  /**
   * Helper para obtener el ancho disponible del contenedor
   */
  function getContainerWidth(container) {
    if (!container) return 580;
    const rect = container.getBoundingClientRect();
    return Math.max(300, Math.floor(rect.width) - 24);
  }

  // ==========================================================================
  // GRÁFICO 1 (UNIVARIADA): Distribución de Demanda por Servicio (Observable Plot)
  // ==========================================================================
  function renderUnivariatePlot() {
    if (!dom.plotUnivariate) return;
    const width = getContainerWidth(dom.plotUnivariate);

    const categoriesData = data.categories.map(d => ({
      ...d,
      isActive: state.selectedCategory === 'ALL' || state.selectedCategory === d.id
    }));

    const yDomain = state.univariateZoom === 'focus' ? [70000, 360000] : [0, 370000];

    const plot = Plot.plot({
      width: width,
      height: 280,
      marginTop: 35,
      marginBottom: 45,
      marginLeft: 70,
      marginRight: 20,
      x: {
        domain: ["EMS", "Traffic", "Fire"],
        label: "Macrocategoría del Incidente",
        labelOffset: 34
      },
      y: {
        domain: yDomain,
        label: "Frecuencia Absoluta de Llamadas",
        grid: true,
        tickFormat: "~s"
      },
      color: {
        domain: ["EMS", "Traffic", "Fire"],
        range: ["#2563eb", "#d97706", "#dc2626"]
      },
      marks: [
        Plot.barY(categoriesData, {
          x: "id",
          y: "count",
          fill: "id",
          fillOpacity: d => (d.isActive ? 0.95 : 0.2),
          stroke: "id",
          strokeWidth: d => (state.selectedCategory === d.id ? 2.5 : 0),
          inset: 16,
          rx: 4,
          tip: true,
          title: d => `${d.name}\n• Total: ${d.count.toLocaleString()} llamadas (${d.percentageFormatted})\n• Carga Basal: ${d.loadFormula}\n• Sensibilidad Temporal: Ventana de oro < ${d.timeSensitivityMin} min\n• Tiempo Simulado: ${d.avgResponseTimeStatic} min (Status Quo) vs ${d.avgResponseTimeDynamic} min (ACO)\n(Haz clic en la barra para filtrar)`
        }),
        Plot.text(categoriesData, {
          x: "id",
          y: "count",
          text: d => `${d.percentageFormatted}\n(${d.count.toLocaleString()})`,
          dy: -18,
          fontSize: 12,
          fontWeight: "700",
          fill: "currentColor",
          lineHeight: 1.25
        }),
        Plot.ruleY([0])
      ]
    });

    // Permitir clic interactivo en las barras para filtrar categoría
    plot.querySelectorAll("rect").forEach((rect, idx) => {
      rect.style.cursor = "pointer";
      rect.addEventListener("click", () => {
        const targetCategory = categoriesData[idx]?.id;
        if (targetCategory) {
          state.selectedCategory = state.selectedCategory === targetCategory ? 'ALL' : targetCategory;
          dom.categoryPills.forEach(p => p.classList.toggle('active', p.dataset.category === state.selectedCategory));
          renderAllPlots();
        }
      });
    });

    dom.plotUnivariate.replaceChildren(plot);
  }

  // ==========================================================================
  // GRÁFICO 2 (BIVARIADA): Dinámica Temporal vs. Tipo de Emergencia (24 Horas)
  // Maneja correctamente picos bimodales, meseta EMS y ventana nocturna continua
  // ==========================================================================
  function renderBivariatePlot() {
    if (!dom.plotBivariate) return;
    const width = getContainerWidth(dom.plotBivariate);

    const minH = state.zoomRange[0];
    const maxH = state.zoomRange[1];

    const series = [];
    data.hourlyDistribution.forEach(h => {
      if (h.hour >= minH && h.hour <= maxH) {
        series.push({
          hour: h.hour,
          timeLabel: h.label,
          category: "EMS",
          calls: h.ems,
          isPeak: h.isPeak && h.peakType === "ems_plateau",
          note: "Demanda médica diurna sostenida (Meseta 10h-16h)"
        });
        series.push({
          hour: h.hour,
          timeLabel: h.label,
          category: "Traffic",
          calls: h.traffic,
          isPeak: h.isPeak && (h.peakType === "traffic_morning" || h.peakType === "traffic_evening"),
          note: "🚨 Pico Bimodal de Tránsito laboral (08h y 17h)"
        });
        series.push({
          hour: h.hour,
          timeLabel: h.label,
          category: "Fire",
          calls: h.fire,
          isPeak: false,
          note: "Carga de incendios moderada y estable"
        });
      }
    });

    const isFull24 = minH === 0 && maxH === 23;

    // Regiones sombreadas para anotar los picos bimodal y meseta
    const shadedRegions = [];
    const regionLabels = [];

    if (isFull24) {
      shadedRegions.push(
        { x1: 7.5, x2: 9.5, fill: "#f59e0b", opacity: 0.12, label: "Pico 1: Tráfico Matutino" },
        { x1: 9.5, x2: 15.5, fill: "#3b82f6", opacity: 0.08, label: "Meseta Diurna EMS" },
        { x1: 15.5, x2: 18.5, fill: "#f59e0b", opacity: 0.15, label: "Pico 2: Tráfico Vespertino" }
      );
      regionLabels.push(
        { x: 8.5, y: 22800, text: "🚨 Pico 1 (08-09h)" },
        { x: 12.5, y: 22800, text: "⚡ Meseta EMS" },
        { x: 17.0, y: 22800, text: "🔥🚨 Pico 2 (16-18h)" }
      );

      // Si está activo el foco nocturno, sombrear la ventana continua (20h a 23h y 00h a 06h)
      if (state.isNightFocus) {
        shadedRegions.push(
          { x1: 0, x2: 6.5, fill: "#6366f1", opacity: 0.18, label: "Valle Nocturno Madrugada" },
          { x1: 19.5, x2: 23, fill: "#6366f1", opacity: 0.18, label: "Valle Nocturno Noche" }
        );
        regionLabels.push(
          { x: 3.0, y: 15000, text: "🌙 Mínimo Operativo (01-05h)" },
          { x: 21.0, y: 15000, text: "🌙 Descenso Nocturno" }
        );
      }
    }

    const plot = Plot.plot({
      width: width,
      height: 280,
      marginTop: 35,
      marginBottom: 45,
      marginLeft: 65,
      marginRight: 20,
      x: {
        domain: [minH, maxH],
        label: "Hora del Día (Formato 24 Horas)",
        ticks: Math.min(maxH - minH + 1, 12),
        tickFormat: d => `${d}:00`,
        labelOffset: 34
      },
      y: {
        domain: [0, 24000],
        label: "Demanda Horaria de Llamadas",
        grid: true,
        tickFormat: "~s"
      },
      color: {
        domain: ["EMS", "Traffic", "Fire"],
        range: ["#2563eb", "#d97706", "#dc2626"]
      },
      marks: [
        Plot.rectX(shadedRegions, {
          x1: "x1",
          x2: "x2",
          fill: "fill",
          fillOpacity: "opacity"
        }),
        Plot.text(regionLabels, {
          x: "x",
          y: "y",
          text: "text",
          fontSize: 10.5,
          fontWeight: "600",
          fill: "currentColor",
          fillOpacity: 0.8
        }),
        Plot.lineY(series, {
          x: "hour",
          y: "calls",
          stroke: "category",
          strokeWidth: d => (state.selectedCategory === 'ALL' || state.selectedCategory === d.category ? 2.8 : 1),
          strokeOpacity: d => (state.selectedCategory === 'ALL' || state.selectedCategory === d.category ? 1 : 0.18),
          curve: "monotone-x"
        }),
        Plot.dot(series, {
          x: "hour",
          y: "calls",
          fill: "category",
          fillOpacity: d => (state.selectedCategory === 'ALL' || state.selectedCategory === d.category ? 1 : 0.2),
          r: d => (d.isPeak ? 4.5 : 2.5),
          stroke: "var(--bg-surface)",
          strokeWidth: 1.5,
          tip: true,
          title: d => `${d.timeLabel} hrs &bull; ${d.category}\n• Volumen: ${d.calls.toLocaleString()} llamadas\n• ${d.note}`
        })
      ]
    });

    dom.plotBivariate.replaceChildren(plot);
  }

  // ==========================================================================
  // GRÁFICO 3 (MULTIVARIADA): Matriz de Saturación Operativa (Heatmap Día x Hora)
  // Recalculado: Lunes-Viernes 16-18h máximo; Viernes 17h pico absoluto
  // ==========================================================================
  function renderMultivariatePlot() {
    if (!dom.plotMultivariate) return;
    const width = getContainerWidth(dom.plotMultivariate);

    const isPeakView = (state.heatmapZoom === 'peak');
    const minH = isPeakView ? 7 : 0;
    const maxH = isPeakView ? 19 : 23;

    // Filtrar celdas según categoría y rango horario de zoom
    const cells = data.heatmapCells
      .filter(c => c.hour >= minH && c.hour <= maxH)
      .map(c => {
        let val = c.total;
        let label = "Demanda Global";
        if (state.selectedCategory === 'EMS') {
          val = c.ems;
          label = "Demanda Médica (EMS)";
        } else if (state.selectedCategory === 'Traffic') {
          val = c.traffic;
          label = "Demanda Vial (Tráfico)";
        } else if (state.selectedCategory === 'Fire') {
          val = c.fire;
          label = "Demanda Incendios (Fire)";
        }

        return {
          ...c,
          metricValue: val,
          metricLabel: label
        };
      });

    // Paleta perceptual continua
    let scheme = "ylorrd";
    if (state.selectedCategory === 'EMS') scheme = "blues";
    else if (state.selectedCategory === 'Traffic') scheme = "ylorbr";
    else if (state.selectedCategory === 'Fire') scheme = "reds";

    const hoursDomain = d3.range(minH, maxH + 1);

    const plot = Plot.plot({
      width: width,
      height: 280,
      marginTop: 25,
      marginBottom: 45,
      marginLeft: 80,
      marginRight: 35,
      x: {
        domain: hoursDomain,
        label: isPeakView ? "Horas Pico Laborales (07:00 a 19:00 hrs)" : "Hora del Día (00:00 a 23:00 hrs)",
        tickFormat: d => `${d}`,
        labelOffset: 34
      },
      y: {
        domain: ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"],
        label: null
      },
      color: {
        type: "linear",
        scheme: scheme,
        label: "Volumen de Incidentes por Franja",
        legend: true
      },
      marks: [
        Plot.cell(cells, {
          x: "hour",
          y: "dayName",
          fill: "metricValue",
          inset: 0.8,
          rx: 2,
          tip: true,
          title: d => `${d.dayName} a las ${d.hourLabel}\n• ${d.metricLabel}: ${d.metricValue.toLocaleString()} llamadas\n• Desglose: EMS: ${d.ems} | Tráfico: ${d.traffic} | Incendios: ${d.fire}\n• Diagnóstico: ${d.satLevel}`
        })
      ]
    });

    dom.plotMultivariate.replaceChildren(plot);
  }

  // ==========================================================================
  // GRÁFICO 4 (GEOESPACIAL): Densidad Territorial y Trampa Reactiva
  // Con leyenda fiel y zoom en cuadrantes núcleo vs periferia
  // ==========================================================================
  function renderGeoPlot() {
    if (!dom.plotGeo) return;
    const width = getContainerWidth(dom.plotGeo);

    // Dominios espaciales según zoom
    let xDomain = [-75.68, -75.05];
    let yDomain = [40.00, 40.38];

    if (state.geoZoom === 'core') {
      xDomain = [-75.45, -75.10];
      yDomain = [40.01, 40.18];
    } else if (state.geoZoom === 'periphery') {
      xDomain = [-75.68, -75.35];
      yDomain = [40.15, 40.38];
    }

    const minH = state.zoomRange[0];
    const maxH = state.zoomRange[1];

    const filteredIncidents = data.geocodedIncidents.filter(pt => {
      const matchCat = state.selectedCategory === 'ALL' || pt.category === state.selectedCategory;
      const matchTime = pt.hour >= minH && pt.hour <= maxH;
      const inX = pt.lng >= xDomain[0] && pt.lng <= xDomain[1];
      const inY = pt.lat >= yDomain[0] && pt.lat <= yDomain[1];
      return matchCat && matchTime && inX && inY;
    });

    const isDynamic = state.activeModel === 'dynamic';

    const plot = Plot.plot({
      width: width,
      height: 290,
      marginTop: 25,
      marginBottom: 45,
      marginLeft: 55,
      marginRight: 20,
      x: {
        domain: xDomain,
        label: "Longitud (° W) — Condado de Montgomery",
        grid: true,
        labelOffset: 34
      },
      y: {
        domain: yDomain,
        label: "Latitud (° N)",
        grid: true
      },
      color: {
        domain: ["EMS", "Traffic", "Fire"],
        range: ["#2563eb", "#d97706", "#dc2626"]
      },
      marks: [
        // Curvas de contorno de densidad espacial (KDE)
        Plot.density(filteredIncidents, {
          x: "lng",
          y: "lat",
          stroke: isDynamic ? "#10b981" : "#ef4444",
          strokeOpacity: 0.35,
          thresholds: 6
        }),
        // Puntos de incidentes con dispersión y transparencia (Azul EMS, Ámbar Tráfico, Rojo Fuego)
        Plot.dot(filteredIncidents, {
          x: "lng",
          y: "lat",
          fill: "category",
          fillOpacity: 0.45,
          r: 2.2,
          tip: true,
          title: d => `${d.township} (${d.category})\n• Hora: ${d.hour}:00 (${d.day})\n• Corredor: ${d.corridor}\n• Retraso Reactivo Simulado: ${d.reactiveDelay} min\n• Retraso Deliberativo ACO: ${d.dynamicDelay} min`
        }),
        // Centros y Nodos de Despacho del Condado (Verde = Balance ACO, Rojo = Desamparo en Reactivo)
        Plot.dot(data.townships.filter(t => t.lng >= xDomain[0] && t.lng <= xDomain[1] && t.lat >= yDomain[0] && t.lat <= yDomain[1]), {
          x: "lng",
          y: "lat",
          r: d => (d.isCore ? 6.5 : 5.0),
          fill: d => (isDynamic ? "#10b981" : (d.isCore ? "#3b82f6" : "#ef4444")),
          stroke: "#ffffff",
          strokeWidth: 1.5,
          tip: true,
          title: d => `${d.name} (${d.zoneType})\n• Total Llamadas: ${d.totalCalls.toLocaleString()}\n• Médicas: ${d.emsPct}% | Tráfico: ${d.trafficPct}% | Fuego: ${d.firePct}%\n• Tiempo en Modelo Actual: ${isDynamic ? d.dynamicTime : d.reactiveTime} min\n• ${d.warning}`
        }),
        // Etiquetas de Municipios Clave
        Plot.text(data.townships.filter(t => t.lng >= xDomain[0] && t.lng <= xDomain[1] && t.lat >= yDomain[0] && t.lat <= yDomain[1]), {
          x: "lng",
          y: "lat",
          text: "name",
          dy: -10,
          fontSize: 10.5,
          fontWeight: "700",
          fill: "currentColor",
          stroke: "var(--bg-surface)",
          strokeWidth: 3,
          paintOrder: "stroke"
        })
      ]
    });

    dom.plotGeo.replaceChildren(plot);
  }

  // ==========================================================================
  // GRÁFICO 5 (INCERTIDUMBRE): Boxplot de Llamadas Diarias (1,688 Días Históricos)
  // Sin encimamiento de etiquetas y con opción de escala focalizada vs completa
  // ==========================================================================
  function renderUncertaintyPlot() {
    if (!dom.plotUncertainty) return;
    const width = getContainerWidth(dom.plotUncertainty);

    const records = data.boxplotRecords.filter(r => {
      return state.selectedCategory === 'ALL' || r.category === state.selectedCategory;
    });

    // Escala Y: Si 'focus', de 0 a 320 para que las cajas tengan altura generosa y no parezcan líneas planas
    const isFocus = (state.boxplotZoom === 'focus');
    const yDomain = isFocus ? [0, 320] : [0, 1300];

    // Anotaciones condicionales que NUNCA se superponen con las cajas ni marcadores
    const plotAnnotations = [];
    if (!isFocus) {
      // En escala completa, resaltar el outlier máximo de tráfico
      plotAnnotations.push(
        Plot.text([
          {
            category: "Traffic",
            calls: 1248,
            text: "❄️ Outlier Máximo: 1,248 llamadas/día (Ventisca invernal)"
          }
        ], {
          x: "category",
          y: "calls",
          text: "text",
          dx: 14,
          dy: -6,
          fontSize: 11,
          fontWeight: "700",
          fill: "#d97706",
          textAnchor: "start"
        })
      );
    } else {
      // En escala focalizada, agregar flecha/nota de bigotes sin estorbar los puntos
      plotAnnotations.push(
        Plot.text([
          { category: "EMS", calls: 300, text: "IQR = 26 (Caja compacta)" },
          { category: "Traffic", calls: 300, text: "IQR = 51 (Doble dispersión)" },
          { category: "Fire", calls: 300, text: "IQR = 16 (Estable)" }
        ], {
          x: "category",
          y: "calls",
          text: "text",
          fontSize: 11,
          fontWeight: "700",
          fill: "currentColor",
          fillOpacity: 0.75
        })
      );
    }

    const plot = Plot.plot({
      width: width,
      height: 320,
      marginTop: 35,
      marginBottom: 45,
      marginLeft: 75,
      marginRight: 40,
      x: {
        domain: ["EMS", "Traffic", "Fire"],
        label: "Macrocategoría del Servicio (N = 1,688 días / ~4.6 años)",
        labelOffset: 34
      },
      y: {
        domain: yDomain,
        label: isFocus ? "Volumen Diario Focalizado (0 a 320 llamadas/día)" : "Volumen Diario con Outliers (0 a 1,300 llamadas/día)",
        grid: true
      },
      color: {
        domain: ["EMS", "Traffic", "Fire"],
        range: ["#2563eb", "#d97706", "#dc2626"]
      },
      marks: [
        // Boxplot nativo de Observable Plot con ancho generoso
        Plot.boxY(records, {
          x: "category",
          y: "calls",
          fill: "category",
          fillOpacity: 0.65,
          stroke: "category",
          strokeWidth: 1.8,
          tip: true
        }),
        ...plotAnnotations
      ]
    });

    dom.plotUncertainty.replaceChildren(plot);
  }

  /**
   * Utilidad Debounce para renderizado eficiente en resize
   */
  function debounce(fn, wait) {
    let timeout;
    return function (...args) {
      clearTimeout(timeout);
      timeout = setTimeout(() => fn.apply(this, args), wait);
    };
  }

  // Inicializar al cargar el DOM
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
