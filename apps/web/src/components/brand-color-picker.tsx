import { brandPresets, isValidHexColor } from "@/lib/branding";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export function BrandColorPicker({
  value,
  onChange,
  preview = false,
}: {
  value: string;
  onChange: (color: string) => void;
  preview?: boolean;
}) {
  const valid = isValidHexColor(value);

  return (
    <div className="space-y-3">
      <div>
        <Label>Cor de destaque</Label>
        <p className="text-xs text-muted-foreground">
          Usada em botões, gráficos e destaques do sistema.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {brandPresets.map((preset) => (
          <button
            key={preset.value}
            type="button"
            title={preset.label}
            aria-label={preset.label}
            onClick={() => onChange(preset.value)}
            className={cn(
              "size-8 rounded-full border-2 transition-transform hover:scale-105",
              value.toLowerCase() === preset.value.toLowerCase()
                ? "border-foreground"
                : "border-border",
            )}
            style={{ backgroundColor: preset.value }}
          />
        ))}
      </div>

      <div className="flex items-center gap-3">
        <input
          type="color"
          value={valid ? value : "#3B4DF6"}
          onChange={(event) => onChange(event.target.value.toUpperCase())}
          className="h-9 w-12 cursor-pointer rounded-md border border-border bg-transparent p-1"
          aria-label="Escolher cor personalizada"
        />
        <Input
          value={value}
          onChange={(event) => onChange(event.target.value.toUpperCase())}
          className="w-32 font-mono"
          maxLength={7}
        />
        {!valid ? <span className="text-xs text-destructive">Use o formato #RRGGBB</span> : null}
      </div>

      {preview && valid ? (
        <div className="flex items-center gap-2 rounded-lg border border-border p-3">
          <span
            className="rounded-md px-3 py-1.5 text-xs font-semibold text-white"
            style={{ backgroundColor: value }}
          >
            Botão principal
          </span>
          <span className="text-xs text-muted-foreground">Prévia da cor escolhida</span>
        </div>
      ) : null}
    </div>
  );
}
