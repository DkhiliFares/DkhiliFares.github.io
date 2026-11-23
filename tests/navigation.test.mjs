import test from 'node:test';
import assert from 'node:assert/strict';
import { layout } from '../src/components/layout.mjs';

test('primary navigation and section rail link to every main section', () => {
  const sections = ['projects', 'skills', 'experience', 'education', 'credentials', 'contact'];
  const html = layout({
    profile: {
      intro: 'Portfolio navigation test',
      github: 'https://example.com/github',
      linkedin: 'https://example.com/linkedin'
    }
  }, {
    title: 'Navigation test',
    body: sections.map(id => `<section id="${id}"></section>`).join('')
  });
  const mainNavigation = html.match(/<nav aria-label="Main navigation">([\s\S]*?)<\/nav>/)[1];
  const sectionRail = html.match(/<nav class="section-rail" aria-label="Page sections">([\s\S]*?)<\/nav>/)[1];

  for (const id of sections) {
    assert.ok(mainNavigation.includes(`#${id}"`), `main navigation is missing #${id}`);
    assert.ok(sectionRail.includes(`href="#${id}"`), `section rail is missing #${id}`);
  }
});


test('header brand includes the profile portrait on nested pages', () => {
  const html = layout({
    profile: {
      intro: 'Portfolio navigation test',
      github: 'https://example.com/github',
      linkedin: 'https://example.com/linkedin'
    }
  }, {
    title: 'Nested navigation test',
    body: '',
    depth: 1,
    page: 'project'
  });
  const brand = html.match(/<a class="identity"[\s\S]*?<\/a>/)[0];

  assert.match(brand, /<span class="monogram" aria-hidden="true"><img src="\.\.\/images\/profile\/fares\.webp" alt="" width="42" height="42"/);
});
