package com.iokl1004.memoir.section;

import com.iokl1004.memoir.auth.LoginUser;
import com.iokl1004.memoir.section.SectionDtos.SectionCreateRequest;
import com.iokl1004.memoir.section.SectionDtos.SectionListItem;
import com.iokl1004.memoir.section.SectionDtos.SectionNameRequest;
import com.iokl1004.memoir.section.SectionDtos.SectionResponse;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
@RequestMapping("/api/sections")
public class SectionController {

    private final SectionService sectionService;

    public SectionController(SectionService sectionService) {
        this.sectionService = sectionService;
    }

    @GetMapping
    public List<SectionListItem> list(@AuthenticationPrincipal LoginUser user) {
        return sectionService.list(user.id());
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public SectionResponse create(@AuthenticationPrincipal LoginUser user,
                                  @Valid @RequestBody SectionCreateRequest request) {
        return SectionResponse.from(sectionService.create(user.id(), request.name(), request.parentId()));
    }

    @PatchMapping("/{id}")
    public SectionResponse rename(@AuthenticationPrincipal LoginUser user, @PathVariable Long id,
                                  @Valid @RequestBody SectionNameRequest request) {
        return SectionResponse.from(sectionService.rename(user.id(), id, request.name()));
    }

    @DeleteMapping("/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(@AuthenticationPrincipal LoginUser user, @PathVariable Long id) {
        sectionService.delete(user.id(), id);
    }
}
