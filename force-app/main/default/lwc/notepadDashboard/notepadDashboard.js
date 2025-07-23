import { LightningElement, api, track, wire } from 'lwc';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import { NavigationMixin } from 'lightning/navigation';
import USER_ID from '@salesforce/user/Id';

// Apex – Notes
import getMyNotes from '@salesforce/apex/NotepadDashboardController.getMyNotes';
import updateNoteText from '@salesforce/apex/NotepadDashboardController.updateNoteText';
import deleteNoteSrv from '@salesforce/apex/NotepadDashboardController.deleteNote';

// Apex – Company Lookup
import getCompanyIdsByNames from '@salesforce/apex/NotepadDashboardController.getCompanyIdsByNames';

// Apex – Reminders
import createNoteReminder from '@salesforce/apex/NoteReminderController.createNoteReminder';
import NoteReminderExists from '@salesforce/apex/NoteReminderController.NoteReminderExists';
import removeNoteReminder from '@salesforce/apex/NoteReminderController.removeNoteReminder';

import { refreshApex } from '@salesforce/apex';

// Static resource icons
import noteEditIcon from '@salesforce/resourceUrl/noteEditIcon';
import noteDeleteIcon from '@salesforce/resourceUrl/noteDeleteIcon';
import noteNotifyMeOnIcon from '@salesforce/resourceUrl/noteNotifyMeOnIcon';
import noteNotfiyMeOffIcon from '@salesforce/resourceUrl/noteNotfiyMeOffIcon';

export default class NotepadDashboard extends NavigationMixin(LightningElement) {
  @api includecompleted;
  @api maxrecords;

  currentUserId = USER_ID;

  @track notes = [];
  noteText = '';
  newNoteDue;
  isAdding = false;
  loading = false;

  showDeleteModal = false;
  notePendingDelete;
  wiredResult;

  editNoteIcon = noteEditIcon;
  deleteNoteIcon = noteDeleteIcon;

  // --------------------------------------------------------------------------
  // Wire: load my notes
  // --------------------------------------------------------------------------
  @wire(getMyNotes, { includeCompleted: '$includecompleted', maxRecords: '$maxrecords' })
  wiredNotes(result) {
    this.wiredResult = result;
    const { data, error } = result;
    if (data) {
      this.notes = data.map((n) => this._mapNote(n));
      this._hydrateCompanyLinks();  // Populate Company__c Id links
      this._hydrateReminders();     // Populate reminder states
      this.loading = false;
    } else if (error) {
      console.error('getMyNotes error', error);
      this._toast('Error', 'Failed to load notes.', 'error');
      this.loading = false;
    } else {
      this.loading = true;
    }
  }

  // --------------------------------------------------------------------------
  // Mapping helpers
  // --------------------------------------------------------------------------
  _mapNote(n) {
    const completed = n.Completed__c === true;
    const companyName = n.TargetObjectName__c; // text field storing company name

    return {
      ...n,
      isEditing: false,
      isCompleted: completed,
      noteTextClass: completed ? 'Note-text completed-note' : 'Note-text',
      stickyNoteClass: completed ? 'sticky-note completed' : 'sticky-note',
      completeButtonClass: completed ? 'complete-icon-button completed' : 'complete-icon-button',
      hasReminder: false,
      notifyButtonClass: 'notify-icon-button',
      notificationIconSrc: noteNotfiyMeOffIcon,
      createdDisplay: this._fmtDate(n.CreatedDate),
      dueDisplay: n.Due_by__c ? this._fmtDate(n.Due_by__c) : null,
      companyName,
      relatedRecordId: null,     // Will be filled by Apex lookup
    };
  }

  _fmtDate(iso) {
    if (!iso) return '';
    try {
      const d = new Date(iso);
      const month = (d.getMonth() + 1).toString().padStart(2, '0');
      const day = d.getDate().toString().padStart(2, '0');
      const year = d.getFullYear().toString().slice(-2);
      let hours = d.getHours();
      const minutes = d.getMinutes().toString().padStart(2, '0');
      const ampm = hours >= 12 ? 'pm' : 'am';
      hours = hours % 12 || 12;
      return `${month}/${day}/${year} ${hours}:${minutes}${ampm}`;
    } catch (e) {
      return iso;
    }
  }

  // --------------------------------------------------------------------------
  // Hydrate Company Links
  // --------------------------------------------------------------------------
  _hydrateCompanyLinks() {
  // collect unique canonical names (trim + lowercase) but keep original mapping
  const canonToOriginal = {};
  const canonNames = [];

  this.notes.forEach((n) => {
    const raw = n.companyName;
    if (!raw) return;
    const canon = raw.trim().toLowerCase();
    if (!canon) return;
    if (!canonToOriginal[canon]) {
      canonToOriginal[canon] = raw; // store first raw version seen
      canonNames.push(raw.trim());  // send trimmed original to Apex
    }
  });

  if (canonNames.length === 0) return;

  getCompanyIdsByNames({ names: canonNames })
    .then((nameIdMap) => {
      // Reindex Apex results canonically (trim + lowercase)
      const normMap = {};
      Object.keys(nameIdMap).forEach((rawName) => {
        const canon = rawName.trim().toLowerCase();
        normMap[canon] = nameIdMap[rawName];
      });

      // Apply to notes
      this.notes = this.notes.map((n) => {
        if (!n.companyName) return n;
        const canon = n.companyName.trim().toLowerCase();
        const id = normMap[canon];
        return id
          ? { ...n, relatedRecordId: id }
          : n;
      });
    })
    .catch((err) => {
      // eslint-disable-next-line no-console
      console.error('getCompanyIdsByNames error', err);
    });
  }

  // --------------------------------------------------------------------------
  // Hydrate Reminder State
  // --------------------------------------------------------------------------
  _hydrateReminders() {
    this.notes.forEach((note, idx) => {
      NoteReminderExists({ userId: this.currentUserId, NoteId: note.Id })
        .then((exists) => {
          const updated = { ...note };
          updated.hasReminder = exists;
          updated.notifyButtonClass = exists
            ? 'notify-icon-button pressed-notification'
            : 'notify-icon-button';
          updated.notificationIconSrc = exists
            ? noteNotifyMeOnIcon
            : noteNotfiyMeOffIcon;
          this._replaceNote(idx, updated);
        })
        .catch((err) => {
          console.error('Reminder check error', err);
        });
    });
  }

  _replaceNote(index, updated) {
    this.notes = [
      ...this.notes.slice(0, index),
      updated,
      ...this.notes.slice(index + 1)
    ];
  }

  // --------------------------------------------------------------------------
  // Navigation - click on the sticky note
  // --------------------------------------------------------------------------
  handleNoteCardClick(event) {
    // Ignore clicks on interactive child controls
    const interactive = event.target.closest('button, a, lightning-button, lightning-input, lightning-textarea');
    if (interactive) return;

    // Grab record id from dataset
    const recordId = event.currentTarget.dataset.recordId;
    if (!recordId) return; // nothing to navigate to

    // Optional: figure out the object to navigate (default Company__c)
    // Because the dataset only has the Id, we lookup note in memory:
    const noteId = event.currentTarget.dataset.noteId; // we'll add this in HTML (see below)
    let apiName = 'Company__c';
    if (noteId) {
      const n = this.notes.find((x) => x.Id === noteId);
      if (n && n.TargetObjectType__c) {
        apiName = n.TargetObjectType__c; // expect e.g., Company__c
      }
    }

    this[NavigationMixin.Navigate]({
      type: 'standard__recordPage',
      attributes: {
        recordId,
        objectApiName: apiName,
        actionName: 'view'
      }
    });
  }


  // --------------------------------------------------------------------------
  // Getters
  // --------------------------------------------------------------------------
  get hasNotes() {
    return this.notes && this.notes.length > 0;
  }

  // --------------------------------------------------------------------------
  // Edit
  // --------------------------------------------------------------------------
  toggleEdit(e) {
    const id = e.currentTarget.dataset.id;
    this.notes = this.notes.map((n) =>
      n.Id === id ? { ...n, isEditing: !n.isEditing } : n
    );
  }

  handleEditChange(e) {
    const id = e.target.dataset.id;
    const txt = e.target.value;
    this.notes = this.notes.map((n) =>
      n.Id === id ? { ...n, Note_Text__c: txt } : n
    );
  }

  cancelEdit(e) {
    const id = e.currentTarget.dataset.id;
    this.notes = this.notes.map((n) =>
      n.Id === id ? { ...n, isEditing: false } : n
    );
  }

  saveUpdatedNote(e) {
    const id = e.currentTarget.dataset.id;
    const note = this.notes.find((n) => n.Id === id);
    if (!note) return;
    updateNoteText({ noteId: id, newText: note.Note_Text__c })
      .then(() => {
        this._toast('Success', 'Note updated.', 'success');
        this.notes = this.notes.map((n) =>
          n.Id === id ? { ...n, isEditing: false } : n
        );
        return refreshApex(this.wiredResult);
      })
      .catch((err) => {
        console.error('updateNoteText error', err);
        this._toast('Error', 'Failed to update note.', 'error');
      });
  }

  // --------------------------------------------------------------------------
  // Delete
  // --------------------------------------------------------------------------
  confirmDelete(e) {
    const id = e.currentTarget.dataset.id;
    this.notePendingDelete = this.notes.find((n) => n.Id === id);
    this.showDeleteModal = true;
  }

  cancelDelete() {
    this.showDeleteModal = false;
    this.notePendingDelete = null;
  }

  deleteNote() {
    if (!this.notePendingDelete) return;
    const id = this.notePendingDelete.Id;
    deleteNoteSrv({ noteId: id })
      .then(() => {
        this._toast('Deleted', 'Note deleted.', 'success');
        this.cancelDelete();
        return refreshApex(this.wiredResult);
      })
      .catch((err) => {
        console.error('deleteNote error', err);
        this._toast('Error', 'Failed to delete note.', 'error');
        this.cancelDelete();
      });
  }

  // --------------------------------------------------------------------------
  // Reminder bell
  // --------------------------------------------------------------------------
  toggleReminder(e) {
    const NoteId = e.currentTarget.dataset.id;
    const NoteIndex = this.notes.findIndex((n) => n.Id === NoteId);
    if (NoteIndex === -1) return;

    NoteReminderExists({ userId: this.currentUserId, NoteId })
      .then((exists) => {
        if (!exists) {
          createNoteReminder({ userId: this.currentUserId, NoteId })
            .then(() => {
              const updatedNote = { ...this.notes[NoteIndex] };
              updatedNote.hasReminder = true;
              updatedNote.notifyButtonClass = 'notify-icon-button pressed-notification';
              updatedNote.notificationIconSrc = noteNotifyMeOnIcon;
              this._replaceNote(NoteIndex, updatedNote);
              this._toast('Notification Enabled', 'You will be notified about this note.', 'success');
              refreshApex(this.wiredResult);
            })
            .catch((error) => {
              console.error('Error creating Note reminder:', error);
              this._toast('Error', 'Failed to enable notification.', 'error');
            });
        } else {
          removeNoteReminder({ userId: this.currentUserId, NoteId })
            .then(() => {
              const updatedNote = { ...this.notes[NoteIndex] };
              updatedNote.hasReminder = false;
              updatedNote.notifyButtonClass = 'notify-icon-button';
              updatedNote.notificationIconSrc = noteNotfiyMeOffIcon;
              this._replaceNote(NoteIndex, updatedNote);
              this._toast('Notification Disabled', 'You will no longer be notified about this note.', 'success');
              refreshApex(this.wiredResult);
            })
            .catch((error) => {
              console.error('Error removing Note reminder:', error);
              this._toast('Error', 'Failed to disable notification.', 'error');
            });
        }
      })
      .catch((error) => {
        console.error('Error checking Note reminder existence:', error);
      });
  }

  // --------------------------------------------------------------------------
  // Toast helper
  // --------------------------------------------------------------------------
  _toast(title, message, variant) {
    this.dispatchEvent(new ShowToastEvent({ title, message, variant }));
  }

  getNoteCardStyle(note) {
  // show pointer only when we have an Id
  return note.relatedRecordId ? 'cursor:pointer;' : '';
  }


}