import { App } from "antd";

interface ConfirmDeleteOptions {
  title: string;
  /** Пояснение: что именно и в каком объёме исчезнет. */
  content?: string;
  okText?: string;
  onConfirm: () => void;
}

/**
 * Подтверждение необратимого действия — модалкой по центру экрана, а не
 * поповером у кнопки. Поповер прилипал к своему углу и мог оказаться в стороне
 * от взгляда, что для «удалить всё» неудачно.
 */
export function useConfirmDelete() {
  const { modal } = App.useApp();
  return ({ title, content, okText = "Удалить", onConfirm }: ConfirmDeleteOptions) => {
    modal.confirm({
      title,
      content,
      okText,
      cancelText: "Отмена",
      okButtonProps: { danger: true },
      centered: true,
      onOk: onConfirm,
    });
  };
}
