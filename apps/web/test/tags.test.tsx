import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const mocks = vi.hoisted(() => ({
  create: vi.fn(async (input: unknown) => input),
  update: vi.fn(async (input: unknown) => input),
  remove: vi.fn(async (input: unknown) => input),
  invalidate: vi.fn(),
}))

vi.mock('../src/api/trpc', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/api/trpc')>()
  const mutation = (spy: (input: unknown) => unknown) => () => ({ mutateAsync: spy, isPending: false, error: null })
  return {
    ...actual,
    trpc: {
      Provider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
      // Writes invalidate the tag list and the catalog (item cards render tags).
      useUtils: () => ({ tags: { list: { invalidate: mocks.invalidate } }, items: { list: { invalidate: mocks.invalidate } } }),
      tags: {
        list: { useQuery: () => ({ data: [{ id: 1, name: 'fragile', color: '#ff0000' }], isLoading: false }) },
        create: { useMutation: mutation(mocks.create) },
        update: { useMutation: mutation(mocks.update) },
        delete: { useMutation: mutation(mocks.remove) },
      },
      settings: {
        get: { useQuery: () => ({ data: undefined, isLoading: false }) },
        update: { useMutation: mutation(vi.fn()) },
      },
    },
  }
})

import { TagsPage } from '../src/features/tags/TagsPage'
import { AppProviders } from '../src/app/AppProviders'

const renderPage = () => render(<AppProviders><TagsPage /></AppProviders>)

beforeEach(() => vi.clearAllMocks())

describe('tags page', () => {
  it('renders a badge per tag, coloured from the tag itself', async () => {
    renderPage()
    const badge = await screen.findByText('fragile')
    // The colour is arbitrary user data, so it is painted inline.
    expect(badge).toHaveStyle({ background: '#ff0000' })
  })

  it('creates a tag with the picked colour', async () => {
    renderPage()
    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'heirloom' } })
    // The native colour input starts on the `tagInput` default.
    expect(screen.getByLabelText('Colour')).toHaveValue('#888888')
    fireEvent.change(screen.getByLabelText('Colour'), { target: { value: '#00ff00' } })

    fireEvent.click(screen.getByRole('button', { name: 'Create tag' }))
    await waitFor(() => expect(mocks.create).toHaveBeenCalledWith({ name: 'heirloom', color: '#00ff00' }))
  })

  it('renames a tag through tags.update, not by re-creating it', async () => {
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))
    expect(screen.getByLabelText('Name')).toHaveValue('fragile')

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'delicate' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    // A rename must target the id — `tags.create` only upserts on the name, so it
    // could not rename anything.
    await waitFor(() => expect(mocks.update).toHaveBeenCalledWith({ id: 1, name: 'delicate', color: '#ff0000' }))
  })

  it('deletes a tag once the confirmation is accepted', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(mocks.remove).toHaveBeenCalledWith({ id: 1 }))
    confirm.mockRestore()
  })
})
