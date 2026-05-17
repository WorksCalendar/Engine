/**
 * recurrence/templates — getEventTemplateById branch coverage.
 *
 * Tests both the "found" and "not found" branches of getEventTemplateById.
 */
import { describe, it, expect } from 'vitest';
import {
  getEventTemplateById,
  BUILT_IN_EVENT_TEMPLATES,
} from '../templates.js';

describe('getEventTemplateById', () => {
  it('returns the matching template when the id exists', () => {
    const tmpl = getEventTemplateById('dailyStandup');
    expect(tmpl).not.toBeNull();
    expect(tmpl!.id).toBe('dailyStandup');
    expect(tmpl!.label).toBe('Daily standup');
  });

  it('returns null when id is not in BUILT_IN_EVENT_TEMPLATES', () => {
    expect(getEventTemplateById('does-not-exist')).toBeNull();
  });

  it('returns null for empty string id', () => {
    expect(getEventTemplateById('')).toBeNull();
  });

  it('returns the "none" template (first entry)', () => {
    const tmpl = getEventTemplateById('none');
    expect(tmpl).not.toBeNull();
    expect(tmpl!.defaults).toBeNull();
  });

  it('BUILT_IN_EVENT_TEMPLATES contains at least one template per category type', () => {
    const ids = BUILT_IN_EVENT_TEMPLATES.map(t => t.id);
    expect(ids).toContain('none');
    expect(ids).toContain('dailyStandup');
    expect(ids).toContain('monthlyReview');
  });
});
