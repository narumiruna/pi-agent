import * as Dialog from "@radix-ui/react-dialog";
import {
  Button,
  Flex,
  RadioGroup,
  Text,
  TextArea,
  TextField,
} from "@radix-ui/themes";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, mutation } from "../api.js";
import type { InteractionEvent } from "../types.js";

interface Props {
  interaction?: InteractionEvent;
  onClose: () => void;
}

export function InteractionDialog({ interaction, onClose }: Props) {
  const { t } = useTranslation();
  const [value, setValue] = useState("");
  const completed = useRef(false);
  useEffect(() => {
    setValue(interaction?.prefill ?? "");
    completed.current = false;
  }, [interaction]);
  if (!interaction) return null;
  const options = interaction.options?.map((option) =>
    typeof option === "string" ? { id: option, label: option } : option,
  );
  const respond = async (response?: string) => {
    if (completed.current) return;
    await api(
      `/api/interactions/${interaction.id}`,
      mutation("POST", response === undefined ? {} : { value: response }),
    );
    completed.current = true;
    onClose();
  };
  const cancel = () => void respond();

  return (
    <Dialog.Root open onOpenChange={(open) => !open && cancel()}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialogOverlay" />
        <Dialog.Content
          className="dialogContent"
          aria-describedby={
            interaction.message ? "interaction-description" : undefined
          }
        >
          <Dialog.Title className="dialogTitle">
            {interaction.title ?? t("interaction")}
          </Dialog.Title>
          {interaction.message && (
            <Text as="p" id="interaction-description" color="gray">
              {interaction.message}
            </Text>
          )}
          {options ? (
            <RadioGroup.Root value={value} onValueChange={setValue}>
              {options.map((option) => (
                <RadioGroup.Item key={option.id} value={option.id}>
                  {option.label}
                </RadioGroup.Item>
              ))}
            </RadioGroup.Root>
          ) : interaction.kind === "confirm" ? null : interaction.kind ===
            "editor" ? (
            <TextArea
              aria-label={interaction.title}
              rows={8}
              value={value}
              onChange={(event) => setValue(event.target.value)}
            />
          ) : (
            <TextField.Root
              autoFocus
              aria-label={interaction.title}
              type={interaction.kind === "secret" ? "password" : "text"}
              placeholder={interaction.placeholder}
              value={value}
              onChange={(event) => setValue(event.target.value)}
            />
          )}
          <Flex gap="3" justify="end" mt="5">
            <Button variant="soft" color="gray" onClick={cancel}>
              {t("cancel")}
            </Button>
            <Button
              disabled={Boolean(options && !value)}
              onClick={() =>
                void respond(interaction.kind === "confirm" ? "true" : value)
              }
            >
              {t("continue")}
            </Button>
          </Flex>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
