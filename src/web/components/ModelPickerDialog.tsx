import * as Dialog from "@radix-ui/react-dialog";
import { Button, Flex, RadioGroup, Text, TextField } from "@radix-ui/themes";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ModelOption } from "../model-access.js";
import { DialogPortal } from "./DialogPortal.js";

interface Props {
  current?: ModelOption;
  models: ModelOption[];
  open: boolean;
  pending: boolean;
  onApply: (model: ModelOption) => Promise<boolean>;
  onOpenChange: (open: boolean) => void;
}

function valueFor(model: ModelOption): string {
  return `${model.provider}/${model.id}`;
}

export function ModelPickerDialog({
  current,
  models,
  open,
  pending,
  onApply,
  onOpenChange,
}: Props) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [provider, setProvider] = useState("all");
  const [selectedValue, setSelectedValue] = useState("");

  useEffect(() => {
    if (open) {
      setQuery("");
      setProvider("all");
      setSelectedValue(current ? valueFor(current) : "");
    }
  }, [current, open]);

  const providers = useMemo(
    () => [...new Set(models.map((model) => model.provider))].sort(),
    [models],
  );
  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return models.filter(
      (model) =>
        (provider === "all" || model.provider === provider) &&
        (!normalized ||
          `${model.name} ${model.id} ${model.provider}`
            .toLocaleLowerCase()
            .includes(normalized)),
    );
  }, [models, provider, query]);
  const selected = models.find((model) => valueFor(model) === selectedValue);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <DialogPortal>
        <Dialog.Overlay className="dialogOverlay" />
        <Dialog.Content
          className="dialogContent modelDialog"
          aria-describedby="model-description"
        >
          <Dialog.Title className="dialogTitle">
            {t("chooseModel")}
          </Dialog.Title>
          <Dialog.Description id="model-description" asChild>
            <Text as="p" size="2" color="gray">
              {t("modelApplyDescription")}
            </Text>
          </Dialog.Description>
          <TextField.Root
            aria-label={t("searchModels")}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("searchModels")}
          />
          {providers.length > 1 && (
            <fieldset
              className="providerFilters"
              aria-label={t("filterProvider")}
            >
              <Button
                size="1"
                variant={provider === "all" ? "solid" : "soft"}
                onClick={() => setProvider("all")}
              >
                {t("allProviders")}
              </Button>
              {providers.map((id) => (
                <Button
                  key={id}
                  size="1"
                  variant={provider === id ? "solid" : "soft"}
                  onClick={() => setProvider(id)}
                >
                  {id}
                </Button>
              ))}
            </fieldset>
          )}
          <RadioGroup.Root
            className="modelChoices"
            aria-label={t("models")}
            value={selectedValue}
            onValueChange={setSelectedValue}
          >
            {filtered.length === 0 ? (
              <Text color="gray">{t("noMatchingModels")}</Text>
            ) : (
              filtered.map((model) => {
                const value = valueFor(model);
                return (
                  <RadioGroup.Item
                    aria-label={`${model.name}, ${model.provider}`}
                    className={`modelChoice${selectedValue === value ? " selected" : ""}`}
                    key={value}
                    value={value}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        setSelectedValue(value);
                      }
                    }}
                  >
                    <span className="modelChoiceText">
                      <strong>{model.name}</strong>
                      <small>
                        {model.provider} · {model.id}
                      </small>
                    </span>
                  </RadioGroup.Item>
                );
              })
            )}
          </RadioGroup.Root>
          <Flex className="modelDialogActions" justify="end" gap="3">
            <Button
              color="gray"
              variant="soft"
              onClick={() => onOpenChange(false)}
            >
              {t("cancel")}
            </Button>
            <Button
              highContrast
              disabled={!selected || pending}
              onClick={() =>
                selected &&
                void onApply(selected).then((applied) => {
                  if (applied) onOpenChange(false);
                })
              }
            >
              {pending ? t("applying") : t("useThisModel")}
            </Button>
          </Flex>
        </Dialog.Content>
      </DialogPortal>
    </Dialog.Root>
  );
}
