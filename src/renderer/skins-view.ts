// Pantalla Skins: visor 3D (skinview3d, cargado como lib/skinview3d.bundle.js), subir PNG, skin de un premium,
// historial y la cabeza de la skin como avatar de la cuenta.

export interface SkinView {
  id: string;
  kind: "png" | "premium";
  name: string;
  variant: "classic" | "slim";
  image: string;
}

export interface SkinList {
  selected?: string;
  history: SkinView[];
  /** Cuenta premium: la skin elegida es la oficial (se sube a Mojang). */
  premium?: boolean;
}

export interface SkinsApi {
  listSkins(): Promise<SkinList>;
  uploadSkin(variant: string): Promise<SkinList>;
  premiumSkin(name: string): Promise<SkinList>;
  selectSkin(id: string | null): Promise<SkinList>;
  setSkinVariant(id: string, variant: string): Promise<SkinList>;
  removeSkin(id: string): Promise<SkinList>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const skinview3d: any;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

/** Dibuja la cara (y la capa del sombrero) de la skin en un canvas de 8x8 escalado sin suavizar. */
function drawHead(canvas: HTMLCanvasElement, image: HTMLImageElement): void {
  canvas.width = 8;
  canvas.height = 8;
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, 8, 8);
  ctx.drawImage(image, 8, 8, 8, 8, 0, 0, 8, 8);
  ctx.drawImage(image, 40, 8, 8, 8, 0, 0, 8, 8);
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((ok, fail) => {
    const img = new Image();
    img.onload = () => ok(img);
    img.onerror = fail;
    img.src = src;
  });
}

/** Skin delgada (slim): los brazos miden 3 pixeles, asi que la columna 54-55 del brazo derecho esta vacia. */
function looksSlim(image: HTMLImageElement): boolean {
  if (image.height !== 64) return false;
  const c = document.createElement("canvas");
  c.width = 64;
  c.height = 64;
  const ctx = c.getContext("2d")!;
  ctx.drawImage(image, 0, 0);
  const data = ctx.getImageData(54, 20, 2, 12).data;
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] !== 0) return false;
  }
  return true;
}

export class SkinsScreen {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private viewer: any;
  private list: SkinList = { history: [] };
  private shownImage = "";

  constructor(private readonly api: SkinsApi, private readonly cleanError: (e: unknown) => string) {
    $("skin-upload").addEventListener("click", () => this.upload());
    $("skin-premium-btn").addEventListener("click", () => this.premium());
    $<HTMLInputElement>("skin-premium").addEventListener("keydown", (e) => e.key === "Enter" && this.premium());
    $("skin-clear").addEventListener("click", () => this.run(() => this.api.selectSkin(null)));
    for (const b of Array.from(document.querySelectorAll<HTMLButtonElement>("#variant button"))) {
      b.addEventListener("click", () => {
        const current = this.current();
        if (current && current.kind === "png") {
          this.run(() => this.api.setSkinVariant(current.id, b.dataset.variant!));
        }
      });
    }
  }

  /** Se llama al entrar en la pestana (el visor solo dibuja mientras se ve) y al cambiar de cuenta. */
  setVisible(visible: boolean): void {
    if (visible && !this.viewer) {
      this.viewer = new skinview3d.SkinViewer({ canvas: $("skin-canvas"), width: 320, height: 420, zoom: 0.85, fov: 50 });
      this.viewer.animation = new skinview3d.WalkingAnimation();
      this.viewer.animation.speed = 0.6;
      this.viewer.controls.enablePan = false;
      this.viewer.autoRotate = false;
      this.shownImage = "";
      this.render();
    }
    if (this.viewer) {
      this.viewer.renderPaused = !visible;
    }
  }

  async refresh(): Promise<void> {
    this.list = await this.api.listSkins();
    this.render();
  }

  private current(): SkinView | undefined {
    return this.list.history.find((s) => s.id === this.list.selected);
  }

  private async run(action: () => Promise<SkinList>): Promise<SkinList | undefined> {
    const error = $("skin-error");
    error.classList.add("hidden");
    try {
      this.list = await action();
      this.render();
      return this.list;
    } catch (e) {
      error.textContent = this.cleanError(e);
      error.classList.remove("hidden");
      return undefined;
    }
  }

  private async upload(): Promise<void> {
    const before = this.list.selected;
    const list = await this.run(() => this.api.uploadSkin("classic"));
    const added = list?.history.find((s) => s.id === list.selected);
    // Recien subida: si los brazos son finos, se marca delgada sola (se puede cambiar con los botones)
    if (added && added.id !== before && added.kind === "png" && looksSlim(await loadImage(added.image)) && added.variant !== "slim") {
      await this.run(() => this.api.setSkinVariant(added.id, "slim"));
    }
  }

  private async premium(): Promise<void> {
    const input = $<HTMLInputElement>("skin-premium");
    const btn = $<HTMLButtonElement>("skin-premium-btn");
    if (!input.value.trim()) return;
    btn.disabled = true;
    btn.textContent = "…";
    const list = await this.run(() => this.api.premiumSkin(input.value));
    btn.disabled = false;
    btn.textContent = "Usar";
    if (list) input.value = "";
  }

  private render(): void {
    const current = this.current();
    $("skin-name").textContent = current ? current.name : "Sin skin";
    $("skin-kind").textContent = !current
      ? "Elige una para tu cuenta"
      : current.kind === "premium" ? "Skin de un jugador premium" : "Skin propia (archivo PNG)";
    $("skin-clear").classList.toggle("hidden", !current || !!this.list.premium);
    $("skin-empty").classList.toggle("hidden", !!current);
    $("skin-note").textContent = this.list.premium
      ? "Cuenta premium: la skin que elijas se pone como tu skin oficial de Minecraft (la verán en todos los servidores)."
      : !current
      ? "La skin que elijas se pone sola al entrar al servidor."
      : current.kind === "premium"
        ? "Se pone sola al entrar al servidor y la verán todos."
        : "Se pone al entrar al servidor en cuanto el servidor active MineSkin (lo que firma las skins para que todos las vean). Mientras, la ves aquí.";
    for (const b of Array.from(document.querySelectorAll<HTMLButtonElement>("#variant button"))) {
      b.classList.toggle("on", !!current && current.variant === b.dataset.variant);
      b.disabled = !current || current.kind !== "png";
    }

    // Visor 3D
    if (this.viewer) {
      const key = current ? current.image + current.variant : "";
      if (key !== this.shownImage) {
        this.shownImage = key;
        if (current) {
          this.viewer.loadSkin(current.image, { model: current.variant === "slim" ? "slim" : "default" });
        } else {
          this.viewer.loadSkin(null);
        }
      }
    }

    // Historial
    const grid = $("skin-history");
    grid.innerHTML = "";
    if (this.list.history.length === 0) {
      grid.innerHTML = '<p class="muted small">Aquí aparecerán las skins que uses.</p>';
    }
    for (const s of this.list.history) {
      const tile = document.createElement("div");
      tile.className = "skin-tile" + (s.id === this.list.selected ? " selected" : "");
      tile.title = s.kind === "premium" ? `Skin de ${s.name}` : s.name;
      tile.innerHTML = '<canvas></canvas><span></span><button class="remove" title="Quitar del historial">✕</button>';
      tile.querySelector("span")!.textContent = s.name;
      loadImage(s.image).then((img) => drawHead(tile.querySelector("canvas")!, img));
      tile.addEventListener("click", () => this.run(() => this.api.selectSkin(s.id)));
      tile.querySelector(".remove")!.addEventListener("click", (ev) => {
        ev.stopPropagation();
        this.run(() => this.api.removeSkin(s.id));
      });
      grid.appendChild(tile);
    }

    // Avatar de la cuenta = cabeza de la skin
    const avatar = $("avatar");
    const existing = avatar.querySelector("canvas");
    if (current) {
      const canvas = existing ?? document.createElement("canvas");
      loadImage(current.image).then((img) => drawHead(canvas, img));
      if (!existing) {
        avatar.textContent = "";
        avatar.appendChild(canvas);
      }
    } else if (existing) {
      avatar.textContent = avatar.dataset.letter ?? "?";
    }
  }
}
