'use client'

import { type ReactNode, useEffect, useRef } from 'react'

export function ConfirmationDialog({
  labelledBy,
  describedBy,
  children,
  onDismiss,
  alert = false,
}: {
  labelledBy: string
  describedBy: string
  children: ReactNode
  onDismiss: () => void
  alert?: boolean
}) {
  const dialog = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const element = dialog.current
    element?.showModal()
    return () => element?.close()
  }, [])

  return (
    <dialog
      ref={dialog}
      className="dialog-backdrop native-dialog"
      role={alert ? 'alertdialog' : undefined}
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      onCancel={(event) => {
        event.preventDefault()
        onDismiss()
      }}
    >
      <section className="confirm-dialog">{children}</section>
    </dialog>
  )
}
